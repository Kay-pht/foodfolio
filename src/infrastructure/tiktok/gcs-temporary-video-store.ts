import { Storage } from "@google-cloud/storage";
import type {
  PublishedVideo,
  TemporaryVideoStore,
} from "../../application/analysis/types.js";
import { GcsTemporaryMediaStore } from "../media/gcs-temporary-media-store.js";

export class GcsTemporaryVideoStore implements TemporaryVideoStore {
  private readonly mediaStore: GcsTemporaryMediaStore;

  constructor(bucketName: string, storage = new Storage()) {
    this.mediaStore = new GcsTemporaryMediaStore(
      {
        bucketName,
        publishFailure: {
          code: "TIKTOK_VIDEO_PUBLISH_FAILED",
          retryable: true,
          message: "Temporary TikTok video publishing failed",
        },
      },
      storage,
    );
  }

  async publish(filePath: string): Promise<PublishedVideo> {
    const published = await this.mediaStore.publish({
      index: 1,
      kind: "video",
      filePath,
      sizeBytes: 0,
      contentType: "video/mp4",
    });
    return {
      url: published.url,
      dispose: published.dispose,
    };
  }
}
