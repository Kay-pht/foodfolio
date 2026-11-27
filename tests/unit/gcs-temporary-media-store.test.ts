import type { Storage } from "@google-cloud/storage";
import { describe, expect, it, vi } from "vitest";
import { GcsTemporaryMediaStore } from "../../src/infrastructure/media/gcs-temporary-media-store.js";

describe("GcsTemporaryMediaStore", () => {
  it("publishes image media with its content type and a ten-minute signed URL by default", async () => {
    const now = 1_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
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
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: "v4",
      action: "read",
      expires: now + 10 * 60 * 1000,
    });
    await published.dispose();
    expect(deleteObject).toHaveBeenCalledWith({ ignoreNotFound: true });
    dateNow.mockRestore();
  });
});

it("never signs a partial video when the source fails after writing bytes", async () => {
  const { PassThrough } = await import("node:stream");
  const upload = new PassThrough();
  upload.resume();
  const deleteObject = vi.fn(async () => {});
  const getSignedUrl = vi.fn();
  const storage = {
    bucket: () => ({
      file: () => ({
        createWriteStream: () => upload,
        delete: deleteObject,
        getSignedUrl,
      }),
    }),
  } as unknown as Storage;
  const store = new GcsTemporaryMediaStore(
    {
      bucketName: "private",
      publishFailure: {
        code: "PUBLISH_FAILED",
        retryable: true,
        message: "failed",
      },
    },
    storage,
  );
  await expect(
    store.publishStream(
      { index: 1, kind: "video", contentType: "video/mp4" },
      async (destination) => {
        destination.write("partial");
        throw new Error("interrupted");
      },
    ),
  ).rejects.toMatchObject({ code: "PUBLISH_FAILED" });
  expect(getSignedUrl).not.toHaveBeenCalled();
  expect(deleteObject).toHaveBeenCalledOnce();
});
