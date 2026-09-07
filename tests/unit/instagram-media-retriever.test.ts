import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MediaCollection,
  MediaRetriever,
} from "../../src/application/analysis/types.js";
import {
  downloadInstagramAsset,
  parseInstagramMediaMetadata,
  YtDlpInstagramMediaRetriever,
  type InstagramMediaAsset,
} from "../../src/infrastructure/instagram/yt-dlp-instagram-media-retriever.js";

const config = {
  binaryPath: "/usr/local/bin/yt-dlp",
  maxAttempts: 2,
  attemptTimeoutMs: 45_000,
  retryBaseSeconds: 1,
  maxRetrySeconds: 1,
};

const singleVideoCollection: MediaCollection = {
  items: [
    {
      index: 1,
      kind: "video",
      filePath: "/tmp/video.mp4",
      sizeBytes: 123,
      contentType: "video/mp4",
    },
  ],
  attempts: 1,
  dispose: async () => {},
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("YtDlpInstagramMediaRetriever", () => {
  it("keeps the existing yt-dlp single-video download path for Reels and video posts", async () => {
    const singleVideoRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => singleVideoCollection),
    };
    const assetDownloader = vi.fn();
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      async () => ({
        formats: [
          {
            url: "https://cdn.example/video.mp4",
            width: 1080,
            height: 1920,
          },
        ],
      }),
      singleVideoRetriever,
      assetDownloader,
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/reel/example/")),
    ).resolves.toBe(singleVideoCollection);
    expect(singleVideoRetriever.retrieve).toHaveBeenCalledOnce();
    expect(assetDownloader).not.toHaveBeenCalled();
  });

  it("retrieves image, video, and mixed carousel entries in original order", async () => {
    const metadata = {
      entries: [
        {
          formats: [],
          thumbnails: [
            { url: "https://cdn.example/1-small.jpg", width: 100 },
            { url: "https://cdn.example/1.jpg", width: 1080 },
          ],
        },
        {
          formats: [
            {
              url: "https://cdn.example/2.mp4",
              width: 1080,
              vcodec: "h264",
              acodec: "aac",
            },
          ],
        },
        {
          formats: [],
          thumbnails: [{ url: "https://cdn.example/3.png", width: 1080 }],
        },
      ],
    };
    const downloadedIndexes: number[] = [];
    const assetDownloader = vi.fn(async (asset: InstagramMediaAsset) => {
      downloadedIndexes.push(asset.index);
      return {
        filePath: `/tmp/${asset.index}`,
        sizeBytes: asset.index * 100,
        contentType: asset.kind === "image" ? "image/jpeg" : "video/mp4",
      };
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      async () => metadata,
      { retrieve: vi.fn() },
      assetDownloader,
      async () => {},
    );

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/p/mixed/"),
    );
    expect(collection.items.map(({ index, kind }) => ({ index, kind }))).toEqual([
      { index: 1, kind: "image" },
      { index: 2, kind: "video" },
      { index: 3, kind: "image" },
    ]);
    expect(downloadedIndexes).toEqual([1, 2, 3]);
    await collection.dispose();
  });

  it("supports a pure video carousel without collapsing it to one video", async () => {
    const metadata = {
      entries: [1, 2].map((index) => ({
        formats: [
          {
            url: `https://cdn.example/${index}.mp4`,
            width: 1080,
            vcodec: "h264",
            acodec: "aac",
          },
        ],
      })),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      async () => metadata,
      { retrieve: vi.fn() },
      async (asset: InstagramMediaAsset) => ({
        filePath: `/tmp/${asset.index}.mp4`,
        sizeBytes: 100,
        contentType: "video/mp4",
      }),
      async () => {},
    );

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/p/videos/"),
    );
    expect(collection.items.map((item) => item.kind)).toEqual([
      "video",
      "video",
    ]);
    await collection.dispose();
  });

  it("rejects the whole post when any metadata entry is unavailable", async () => {
    const assetDownloader = vi.fn();
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      async () => ({
        entries: [
          { formats: [], thumbnails: [{ url: "https://cdn.example/1.jpg" }] },
          null,
        ],
      }),
      { retrieve: vi.fn() },
      assetDownloader,
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/p/incomplete/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_UNSUPPORTED_MEDIA",
      retryable: false,
    });
    expect(assetDownloader).not.toHaveBeenCalled();
  });

  it("retries the whole carousel and fails atomically when one entry download fails", async () => {
    const metadata = {
      entries: [
        { formats: [], thumbnails: [{ url: "https://cdn.example/1.jpg" }] },
        { formats: [], thumbnails: [{ url: "https://cdn.example/2.jpg" }] },
      ],
    };
    const assetDownloader = vi.fn(async (asset: InstagramMediaAsset) => {
      if (asset.index === 2) throw new Error("HTTP 503");
      return {
        filePath: "/tmp/1.jpg",
        sizeBytes: 100,
        contentType: "image/jpeg",
      };
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      async () => metadata,
      { retrieve: vi.fn() },
      assetDownloader,
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/p/images/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      retryable: false,
    });
    expect(assetDownloader).toHaveBeenCalledTimes(4);
  });

  it("maps repeated metadata probe failures to a retryable analysis error", async () => {
    const metadataProbe = vi.fn(async () => {
      throw new Error("yt-dlp failed");
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      metadataProbe,
      { retrieve: vi.fn() },
      vi.fn(),
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/p/example/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_METADATA_FAILED",
      retryable: true,
    });
    expect(metadataProbe).toHaveBeenCalledTimes(2);
  });

  it("rejects non-Instagram URLs before probing metadata", async () => {
    const metadataProbe = vi.fn();
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      metadataProbe,
      { retrieve: vi.fn() },
      vi.fn(),
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://example.com/p/123")),
    ).rejects.toMatchObject({ code: "INSTAGRAM_MEDIA_URL_INVALID" });
    expect(metadataProbe).not.toHaveBeenCalled();
  });
});

describe("Instagram media metadata and HTTP download", () => {
  it("chooses the largest image candidate and preserves its entry index", () => {
    expect(
      parseInstagramMediaMetadata({
        entries: [
          {
            thumbnails: [
              { url: "https://cdn.example/small.jpg", width: 320, height: 320 },
              { url: "https://cdn.example/large.jpg", width: 1080, height: 1080 },
            ],
          },
        ],
      }),
    ).toEqual({
      assets: [
        {
          index: 1,
          kind: "image",
          url: "https://cdn.example/large.jpg",
          httpHeaders: {},
        },
      ],
      unavailableEntryCount: 0,
    });
  });

  it("streams a supported image to disk without buffering the collection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-test-instagram-"));
    temporaryDirectories.push(directory);
    const result = await downloadInstagramAsset(
      {
        index: 1,
        kind: "image",
        url: "https://cdn.example/photo.jpg",
        httpHeaders: {},
      },
      directory,
      1_000,
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg", "content-length": "3" },
        }),
    );

    expect(result.sizeBytes).toBe(3);
    expect(result.contentType).toBe("image/jpeg");
    expect([...(await readFile(result.filePath))]).toEqual([1, 2, 3]);
  });

  it("rejects image formats the AI provider does not accept", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-test-instagram-"));
    temporaryDirectories.push(directory);

    await expect(
      downloadInstagramAsset(
        {
          index: 1,
          kind: "image",
          url: "https://cdn.example/photo.webp",
          httpHeaders: {},
        },
        directory,
        1_000,
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-type": "image/webp" },
          }),
      ),
    ).rejects.toThrow("unsupported by the AI provider");
  });
});
