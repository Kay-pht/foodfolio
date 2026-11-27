import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Storage } from "@google-cloud/storage";
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
      async (bucket, objectName) => {
        const destination = bucket.file(objectName).createWriteStream({
          ...uploadOptions(media.contentType),
          timeout: this.config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS,
        });
        try {
          await write(destination);
        } finally {
          if (!destination.writableFinished) destination.destroy();
        }
      },
      true,
    );

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
  if (!error || typeof error !== "object" || !("code" in error)) return true;
  const status = Number(error.code);
  return (
    !Number.isInteger(status) ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}
