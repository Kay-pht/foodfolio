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

it("times out after a storage server reads the body without responding", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const { Storage: StorageClient } = await import("@google-cloud/storage");
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request so only the response is stalled.
    }
    requests.push(request.method ?? "");
    if (request.method === "DELETE") response.writeHead(204).end();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  const store = new GcsTemporaryMediaStore(
    {
      bucketName: "fixture",
      streamTimeoutMs: 60,
      publishFailure: {
        code: "PUBLISH_FAILED",
        retryable: true,
        message: "failed",
      },
    },
    new StorageClient({
      apiEndpoint: `http://127.0.0.1:${address.port}`,
      useAuthWithCustomEndpoint: false,
      retryOptions: { autoRetry: false },
    }),
  );
  const timer = AbortSignal.timeout(900);
  try {
    await expect(
      Promise.race([
        store.publishStream(
          { index: 1, kind: "video", contentType: "video/mp4" },
          (destination) =>
            pipeline(Readable.from([Buffer.from("video")]), destination),
        ),
        once(timer, "abort").then(() => {
          throw new Error("storage did not time out");
        }),
      ]),
    ).rejects.toMatchObject({ code: "PUBLISH_FAILED", retryable: true });
    expect(requests).toEqual(["POST", "DELETE"]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
