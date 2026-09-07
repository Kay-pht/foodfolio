import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsTemporaryMediaStore } from "../../src/infrastructure/media/gcs-temporary-media-store.js";

describe("GcsTemporaryMediaStore", () => {
  it("publishes image media with its content type and keeps media metadata", async () => {
    const deleteObject = vi.fn(async () => {});
    const getSignedUrl = vi.fn(async () => ["https://storage.example/image"]);
    const file = vi.fn(() => ({
      delete: deleteObject,
      getSignedUrl,
    }));
    const upload = vi.fn(async () => []);
    const storage = {
      bucket: vi.fn(() => ({ upload, file })),
    } as unknown as Storage;
    const store = new GcsTemporaryMediaStore(
      {
        bucketName: "private-media-bucket",
        publishFailure: {
          code: "MEDIA_PUBLISH_FAILED",
          retryable: true,
          message: "media publish failed",
        },
      },
      storage,
    );

    const published = await store.publish({
      index: 2,
      kind: "image",
      filePath: "/tmp/photo.jpg",
      sizeBytes: 123,
      contentType: "image/jpeg",
    });

    expect(published).toEqual(
      expect.objectContaining({
        url: "https://storage.example/image",
        kind: "image",
        contentType: "image/jpeg",
      }),
    );
    expect(upload).toHaveBeenCalledWith(
      "/tmp/photo.jpg",
      expect.objectContaining({
        destination: expect.stringMatching(/^pending\/.+\.jpg$/),
        metadata: expect.objectContaining({ contentType: "image/jpeg" }),
      }),
    );
    await published.dispose();
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
