import { Storage } from "@google-cloud/storage";
import { GcsTemporaryMediaStore } from "../media/gcs-temporary-media-store.js";

export class GcsTemporaryVideoStore extends GcsTemporaryMediaStore {
  constructor(bucketName: string, storage = new Storage()) {
    super(
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
}
