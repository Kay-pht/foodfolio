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
  const deleteObject = vi.fn(async () => {});
  const getSignedUrl = vi.fn();
  const { Storage: StorageClient } = await import("@google-cloud/storage");
  const storage = {
    apiEndpoint: "http://127.0.0.1:9",
    authClient: { getRequestHeaders: async () => ({}) },
    crc32cGenerator: new StorageClient().crc32cGenerator,
    bucket: () => ({
      file: () => ({
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
  let uploadedBytes = 0;
  const server = createServer(async (request, response) => {
    for await (const chunk of request)
      uploadedBytes += (chunk as Buffer).length;
    requests.push(request.method ?? "");
    if (request.method === "DELETE") response.writeHead(204).end();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  const storage = new StorageClient({
    apiEndpoint: `http://127.0.0.1:${address.port}`,
    useAuthWithCustomEndpoint: false,
    retryOptions: { autoRetry: false },
  });
  vi.spyOn(storage.authClient, "getRequestHeaders").mockResolvedValue({});
  const store = new GcsTemporaryMediaStore(
    {
      bucketName: "fixture",
      streamTimeoutMs: 150,
      publishFailure: {
        code: "PUBLISH_FAILED",
        retryable: true,
        message: "failed",
      },
    },
    storage,
  );
  const timer = AbortSignal.timeout(1_500);
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
    expect(uploadedBytes).toBeGreaterThan(5);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it.each([
  { status: 403, attempts: 1, retryable: false },
  { status: 503, attempts: 2, retryable: true },
])(
  "uses the video retry budget for storage status $status",
  async ({ status, attempts, retryable }) => {
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { Storage: StorageClient } = await import("@google-cloud/storage");
    const { YtDlpTikTokVideoDownloader } =
      await import("../../src/infrastructure/tiktok/yt-dlp-video-downloader.js");
    const operations: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      operations.push(request.method ?? "");
      if (
        request.method === "POST" &&
        !Buffer.concat(chunks).includes("\r\nvideo\r\n")
      ) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(request.method === "DELETE" ? 404 : status).end();
    }).listen(0, "127.0.0.1");
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-gcs-status-"));
    try {
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No test address");
      const storage = new StorageClient({
        apiEndpoint: `http://127.0.0.1:${address.port}`,
        useAuthWithCustomEndpoint: false,
        retryOptions: { autoRetry: false },
      });
      vi.spyOn(storage.authClient, "getRequestHeaders").mockResolvedValue({});
      const store = new GcsTemporaryMediaStore(
        {
          bucketName: "fixture",
          publishFailure: {
            code: "PUBLISH_FAILED",
            retryable: true,
            message: "failed",
          },
        },
        storage,
      );
      const binaryPath = join(directory, "yt-dlp");
      await writeFile(binaryPath, "#!/bin/sh\nprintf video\n", { mode: 0o700 });
      const backoff = vi.fn(async () => {});
      const downloader = new YtDlpTikTokVideoDownloader(
        {
          binaryPath,
          maxAttempts: 2,
          attemptTimeoutMs: 5_000,
          retryBaseSeconds: 2,
          maxRetrySeconds: 10,
        },
        backoff,
      );
      await expect(
        downloader.publish(
          new URL("https://www.tiktok.com/@chef/video/123"),
          store.publishStream,
        ),
      ).rejects.toMatchObject({ code: "PUBLISH_FAILED", retryable });
      expect(operations).toEqual(
        Array.from({ length: attempts }, () => ["POST", "DELETE"]).flat(),
      );
      expect(backoff).toHaveBeenCalledTimes(attempts - 1);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
