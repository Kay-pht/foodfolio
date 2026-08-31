import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import {
  AnalysisError,
  type PublishedVideo,
  type TemporaryVideoStore,
} from "../../application/analysis/types.js";

const SIGNED_URL_LIFETIME_MS = 10 * 60 * 1000;

export class GcsTemporaryVideoStore implements TemporaryVideoStore {
  constructor(
    private readonly bucketName: string,
    private readonly storage = new Storage(),
  ) {}

  async publish(filePath: string): Promise<PublishedVideo> {
    const objectName = `pending/${randomUUID()}.mp4`;
    const bucket = this.storage.bucket(this.bucketName);
    try {
      await bucket.upload(filePath, {
        destination: objectName,
        metadata: {
          contentType: "video/mp4",
          cacheControl: "private, no-store, max-age=0",
        },
        resumable: false,
        validation: "crc32c",
      });
      const file = bucket.file(objectName);
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + SIGNED_URL_LIFETIME_MS,
      });
      return {
        url,
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
        "TIKTOK_VIDEO_PUBLISH_FAILED",
        true,
        "Temporary TikTok video publishing failed",
      );
    }
  }
}
