import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsTemporaryVideoStore } from "../../src/infrastructure/tiktok/gcs-temporary-video-store.js";

describe("GcsTemporaryVideoStore", () => {
  it("uploads privately, returns a ten-minute signed URL, and deletes the object", async () => {
    const deleteObject = vi.fn(async () => {});
    const getSignedUrl = vi.fn(async () => ["https://storage.example/signed"]);
    const file = vi.fn(() => ({
      delete: deleteObject,
      getSignedUrl,
    }));
    const upload = vi.fn(async () => []);
    const storage = {
      bucket: vi.fn(() => ({ upload, file })),
    } as unknown as Storage;
    const store = new GcsTemporaryVideoStore("private-video-bucket", storage);
    const before = Date.now();

    const published = await store.publish("/tmp/video.mp4");

    expect(published.url).toBe("https://storage.example/signed");
    expect(upload).toHaveBeenCalledWith(
      "/tmp/video.mp4",
      expect.objectContaining({
        resumable: false,
        validation: "crc32c",
        metadata: expect.objectContaining({ contentType: "video/mp4" }),
      }),
    );
    const uploadOptions = upload.mock.calls[0]?.[1] as
      { destination?: string } | undefined;
    expect(uploadOptions?.destination).toMatch(/^pending\/.+\.mp4$/);
    const signedOptions = getSignedUrl.mock.calls[0]?.[0] as
      { expires?: number } | undefined;
    expect(signedOptions?.expires).toBeGreaterThanOrEqual(
      before + 10 * 60 * 1000,
    );
    expect(signedOptions?.expires).toBeLessThanOrEqual(
      Date.now() + 10 * 60 * 1000,
    );
    await published.dispose();
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
