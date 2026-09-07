import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Storage } from "@google-cloud/storage";
import {
  AnalysisError,
  type LocalMediaItem,
  type PublishedMedia,
  type TemporaryMediaStore,
} from "../../application/analysis/types.js";
import type { MediaRetrievalErrorSpec } from "./yt-dlp-media-retriever.js";

const DEFAULT_SIGNED_URL_LIFETIME_MS = 10 * 60 * 1000;

export interface GcsTemporaryMediaStoreConfig {
  bucketName: string;
  publishFailure: MediaRetrievalErrorSpec;
  signedUrlLifetimeMs?: number;
}

export class GcsTemporaryMediaStore implements TemporaryMediaStore {
  constructor(
    private readonly config: GcsTemporaryMediaStoreConfig,
    private readonly storage = new Storage(),
  ) {}

  async publish(media: LocalMediaItem): Promise<PublishedMedia> {
    const objectName = `pending/${randomUUID()}${extensionFor(media)}`;
    const bucket = this.storage.bucket(this.config.bucketName);
    try {
      await bucket.upload(media.filePath, {
        destination: objectName,
        metadata: {
          contentType: media.contentType,
          cacheControl: "private, no-store, max-age=0",
        },
        resumable: false,
        validation: "crc32c",
      });
      const file = bucket.file(objectName);
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
    } catch {
      await bucket
        .file(objectName)
        .delete({ ignoreNotFound: true })
        .catch(() => {});
      throw new AnalysisError(
        this.config.publishFailure.code,
        this.config.publishFailure.retryable,
        this.config.publishFailure.message,
      );
    }
  }
}

function extensionFor(media: LocalMediaItem): string {
  const fromPath = extname(media.filePath).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/u.test(fromPath)) return fromPath;
  if (media.contentType === "video/mp4") return ".mp4";
  if (media.contentType === "image/jpeg") return ".jpg";
  if (media.contentType === "image/png") return ".png";
  if (media.contentType === "image/webp") return ".webp";
  return media.kind === "video" ? ".video" : ".image";
}
