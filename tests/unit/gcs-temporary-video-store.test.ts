import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsTemporaryVideoStore } from "../../src/infrastructure/tiktok/gcs-temporary-video-store.js";

describe("GcsTemporaryVideoStore", () => {
  it("uploads privately, returns a ten-minute signed URL, and deletes the object", async () => {
    const deleteObject = vi.fn(async () => {});
    const getSignedUrl = vi.fn(async () => ["https://storage.example/signed"]);
    const createWriteStream = vi.fn(
      () =>
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
    );
    const file = vi.fn(() => ({
      createWriteStream,
      delete: deleteObject,
      getSignedUrl,
    }));
    const storage = {
      bucket: vi.fn(() => ({ file })),
    } as unknown as Storage;
    const store = new GcsTemporaryVideoStore("private-video-bucket", storage);
    const before = Date.now();

    const published = await store.publishStream(
      { index: 1, kind: "video", contentType: "video/mp4" },
      (destination) =>
        pipeline(Readable.from([Buffer.from("video")]), destination),
    );

    expect(published.url).toBe("https://storage.example/signed");
    expect(createWriteStream).toHaveBeenCalledWith(
      expect.objectContaining({
        resumable: false,
        validation: "crc32c",
        metadata: expect.objectContaining({ contentType: "video/mp4" }),
      }),
    );
    expect(file).toHaveBeenCalledWith(
      expect.stringMatching(/^pending\/.+\.mp4$/),
    );
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
