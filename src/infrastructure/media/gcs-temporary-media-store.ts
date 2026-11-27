import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { request } from "undici";
import {
  AnalysisError,
  type LocalMediaItem,
  type MediaOperationErrorSpec,
  type PublishedMedia,
  type TemporaryMediaStore,
} from "../../application/analysis/types.js";

import {
  VideoSizeError,
  VideoSourceError,
  type VideoStreamPublisher,
} from "./video-stream.js";

const DEFAULT_SIGNED_URL_LIFETIME_MS = 10 * 60 * 1000;
const DEFAULT_STREAM_TIMEOUT_MS = 45_000;

class StorageUploadHttpError extends Error {
  constructor(readonly status: number) {
    super("Cloud Storage upload failed");
  }
}

export interface GcsTemporaryMediaStoreConfig {
  bucketName: string;
  publishFailure: MediaOperationErrorSpec;
  signedUrlLifetimeMs?: number;
  streamTimeoutMs?: number;
}

export class GcsTemporaryMediaStore implements TemporaryMediaStore {
  constructor(
    private readonly config: GcsTemporaryMediaStoreConfig,
    private readonly storage = new Storage(),
  ) {}

  async publish(media: LocalMediaItem): Promise<PublishedMedia> {
    return this.publishObject(
      media,
      extensionFor(media),
      async (bucket, objectName) => {
        await bucket.upload(media.filePath, {
          destination: objectName,
          ...uploadOptions(media.contentType),
        });
      },
    );
  }

  publishStream: VideoStreamPublisher = async (media, write) =>
    this.publishObject(
      media,
      extensionFor(media),
      (_bucket, objectName) =>
        this.uploadVideo(objectName, media.contentType, write),
      true,
    );

  private async uploadVideo(
    objectName: string,
    contentType: string,
    write: Parameters<VideoStreamPublisher>[1],
  ): Promise<void> {
    const endpoint = new URL(
      `/upload/storage/v1/b/${encodeURIComponent(this.config.bucketName)}/o`,
      this.storage.apiEndpoint,
    );
    endpoint.search = new URLSearchParams({
      uploadType: "multipart",
      name: objectName,
    }).toString();
    const boundary = randomUUID();
    const checksum = this.storage.crc32cGenerator();
    const destination = new PassThrough();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        this.config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS,
      ),
    ]);
    async function* multipartBody() {
      yield Buffer.from(
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(uploadOptions(contentType).metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      );
      for await (const chunk of destination as AsyncIterable<Buffer>) {
        checksum.update(chunk);
        yield chunk;
      }
      yield Buffer.from(`\r\n--${boundary}--\r\n`);
    }
    // The SDK's multipart wrapper does not abort a stalled HTTP response.
    // Use the same authenticated JSON API request with an abortable body.
    const authorization = await this.storage.authClient.getRequestHeaders(
      endpoint.href,
    );
    const upload = request(endpoint, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body: Readable.from(multipartBody(), { objectMode: false }),
      signal,
    }).then(async (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        throw Object.assign(new Error("Cloud Storage upload failed"), {
          code: response.statusCode,
        });
      }
      const metadata = (await response.body.json()) as { crc32c?: unknown };
      if (
        typeof metadata?.crc32c !== "string" ||
        !checksum.validate(metadata.crc32c)
      ) {
        throw new Error("Cloud Storage checksum did not match");
      }
    });
    const transfer = Promise.resolve().then(() => write(destination));
    try {
      await Promise.all([upload, transfer]);
    } catch (error) {
      controller.abort();
      destination.destroy();
      await Promise.allSettled([upload, transfer]);
      throw error;
    }
  }

  private async publishObject(
    media: Pick<LocalMediaItem, "kind" | "contentType">,
    extension: string,
    upload: (
      bucket: ReturnType<Storage["bucket"]>,
      objectName: string,
    ) => Promise<void>,
    streaming = false,
  ): Promise<PublishedMedia> {
    const objectName = `pending/${randomUUID()}${extension}`;
    const bucket = this.storage.bucket(this.config.bucketName);
    const file = bucket.file(objectName);
    try {
      await upload(bucket, objectName);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires:
          Date.now() +
          (this.config.signedUrlLifetimeMs ?? DEFAULT_SIGNED_URL_LIFETIME_MS),
      });
      return {
        url,
        kind: media.kind,
        contentType: media.contentType,
        dispose: async () => {
          await file.delete({ ignoreNotFound: true });
        },
      };
    } catch (error) {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch {
        if (streaming) {
          throw new AnalysisError(
            this.config.publishFailure.code,
            false,
            "Temporary video cleanup failed",
            undefined,
            {
              mediaFailureStage: "published_cleanup",
              mediaFailureClass: "storage",
            },
          );
        }
      }
      if (
        error instanceof VideoSizeError ||
        error instanceof VideoSourceError ||
        error instanceof AnalysisError
      )
        throw error;
      throw new AnalysisError(
        this.config.publishFailure.code,
        this.config.publishFailure.retryable &&
          (!streaming || isTransientStorageFailure(error)),
        this.config.publishFailure.message,
      );
    }
  }
}

function uploadOptions(contentType: string) {
  return {
    metadata: { contentType, cacheControl: "private, no-store, max-age=0" },
    resumable: false,
    validation: "crc32c" as const,
  };
}

function extensionFor(
  media: Pick<LocalMediaItem, "contentType" | "kind"> & { filePath?: string },
): string {
  const fromPath = extname(media.filePath ?? "").toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/u.test(fromPath)) return fromPath;
  if (media.contentType === "video/mp4") return ".mp4";
  if (media.contentType === "video/quicktime") return ".mov";
  if (media.contentType === "video/x-matroska") return ".mkv";
  if (media.contentType === "image/jpeg") return ".jpg";
  if (media.contentType === "image/png") return ".png";
  if (media.contentType === "image/webp") return ".webp";
  return media.kind === "video" ? ".video" : ".image";
}

function isTransientStorageFailure(error: unknown): boolean {
  if (!(error instanceof StorageUploadHttpError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}
