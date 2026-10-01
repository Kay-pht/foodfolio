import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalysisError,
  type LocalMediaItem,
  type MediaCollection,
  type MediaRetriever,
  type TemporaryMediaStore,
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

const temporaryDirectories: string[] = [];

function createMediaStore(
  dispose: () => Promise<void> = async () => {},
): TemporaryMediaStore {
  return {
    publish: vi.fn(async (item: LocalMediaItem) => ({
      url: `https://storage.example/${item.index}`,
      kind: item.kind,
      contentType: item.contentType,
      dispose,
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("YtDlpInstagramMediaRetriever", () => {
  it("keeps the existing yt-dlp single-video download path for Reels and video posts", async () => {
    const disposeLocal = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
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
      dispose: disposeLocal,
    };
    const singleVideoRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => singleVideoCollection),
    };
    const assetDownloader = vi.fn();
    const mediaStore = createMediaStore(disposePublished);
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      mediaStore,
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

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/reel/example/"),
    );
    expect(collection.items).toEqual([
      expect.objectContaining({
        index: 1,
        kind: "video",
        url: "https://storage.example/1",
      }),
    ]);
    expect(singleVideoRetriever.retrieve).toHaveBeenCalledOnce();
    expect(mediaStore.publish).toHaveBeenCalledWith(
      singleVideoCollection.items[0],
    );
    expect(disposeLocal).toHaveBeenCalledOnce();
    expect(assetDownloader).not.toHaveBeenCalled();
    await collection.dispose();
    expect(disposePublished).toHaveBeenCalledOnce();
  });

  it("preserves inner single-video local preparation diagnostics", async () => {
    const singleVideoRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => {
        throw new AnalysisError(
          "INTERNAL_ANALYSIS_ERROR",
          true,
          "Instagram single-video local preparation failed",
          undefined,
          {
            mediaFailureStage: "local_prepare",
            mediaFailureClass: "filesystem",
            mediaIndex: 1,
            mediaKind: "video",
          },
        );
      }),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
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
      vi.fn(),
      async () => {},
    );

    let failure: unknown;
    try {
      await retriever.retrieve(
        new URL("https://www.instagram.com/reel/no-temp-dir/"),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "local_prepare",
        mediaFailureClass: "filesystem",
        mediaIndex: 1,
        mediaKind: "video",
      },
    });
    expect(
      (failure as { diagnostics?: Record<string, unknown> }).diagnostics,
    ).not.toHaveProperty("mediaAttempt");
    expect(
      (failure as { diagnostics?: Record<string, unknown> }).diagnostics,
    ).not.toHaveProperty("mediaMaxAttempts");
  });

  it("preserves inner single-video retry cleanup diagnostics and attempt count", async () => {
    const singleVideoRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => {
        throw new AnalysisError(
          "INTERNAL_ANALYSIS_ERROR",
          true,
          "Instagram single-video local cleanup failed",
          undefined,
          {
            mediaFailureStage: "local_cleanup",
            mediaFailureClass: "filesystem",
            mediaIndex: 1,
            mediaKind: "video",
            mediaAttempt: 2,
            mediaMaxAttempts: 2,
          },
        );
      }),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
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
      vi.fn(),
      async () => {},
    );

    await expect(
      retriever.retrieve(
        new URL("https://www.instagram.com/reel/retry-cleanup/"),
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "local_cleanup",
        mediaFailureClass: "filesystem",
        mediaIndex: 1,
        mediaKind: "video",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
  });

  it("classifies single-video local cleanup independently from published cleanup", async () => {
    const disposeLocal = vi.fn(async () => {
      throw new Error("local cleanup failed");
    });
    const disposePublished = vi.fn(async () => {});
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
      dispose: disposeLocal,
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(disposePublished),
      async () => ({
        formats: [
          {
            url: "https://cdn.example/video.mp4",
            width: 1080,
            height: 1920,
          },
        ],
      }),
      { retrieve: vi.fn(async () => singleVideoCollection) },
      vi.fn(),
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/reel/cleanup/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_CLEANUP_FAILED",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "local_cleanup",
        mediaFailureClass: "filesystem",
        mediaIndex: 1,
        mediaKind: "video",
        mediaAttempt: 1,
        mediaMaxAttempts: 2,
      },
    });
    expect(disposeLocal).toHaveBeenCalledTimes(2);
    expect(disposePublished).toHaveBeenCalledOnce();
  });

  it("downloads, publishes, and deletes each carousel item before starting the next", async () => {
    const metadata = {
      entries: [1, 2, 3].map((index) => ({
        formats: [],
        thumbnails: [{ url: `https://cdn.example/${index}.jpg` }],
      })),
    };
    const events: string[] = [];
    const downloadedPaths: string[] = [];
    const assetDownloader = vi.fn(
      async (asset: InstagramMediaAsset, workDirectory: string) => {
        if (downloadedPaths.length) {
          await expect(
            access(downloadedPaths[downloadedPaths.length - 1]!),
          ).rejects.toThrow();
        }
        events.push(`download:${asset.index}`);
        const filePath = join(workDirectory, `${asset.index}.jpg`);
        await writeFile(filePath, new Uint8Array([asset.index]));
        downloadedPaths.push(filePath);
        return { filePath, sizeBytes: 1, contentType: "image/jpeg" };
      },
    );
    const mediaStore: TemporaryMediaStore = {
      publish: vi.fn(async (item) => {
        await expect(readFile(item.filePath)).resolves.toHaveLength(1);
        events.push(`publish:${item.index}`);
        return {
          url: `https://storage.example/${item.index}`,
          kind: item.kind,
          contentType: item.contentType,
          dispose: async () => {},
        };
      }),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      mediaStore,
      async () => metadata,
      { retrieve: vi.fn() },
      assetDownloader,
      async () => {},
    );

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/p/sequential/"),
    );

    expect(events).toEqual([
      "download:1",
      "publish:1",
      "download:2",
      "publish:2",
      "download:3",
      "publish:3",
    ]);
    await Promise.all(
      downloadedPaths.map((filePath) =>
        expect(access(filePath)).rejects.toThrow(),
      ),
    );
    await collection.dispose();
  });

  it("preserves item and attempt context when disposing a returned carousel", async () => {
    const metadata = {
      entries: [1, 2].map((index) => ({
        formats: [],
        thumbnails: [{ url: `https://cdn.example/${index}.jpg` }],
      })),
    };
    const mediaStore: TemporaryMediaStore = {
      publish: vi.fn(async (item) => ({
        url: `https://storage.example/${item.index}`,
        kind: item.kind,
        contentType: item.contentType,
        dispose: async () => {
          if (item.index === 2) throw new Error("private storage detail");
        },
      })),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      mediaStore,
      async () => metadata,
      { retrieve: vi.fn() },
      async (asset) => ({
        filePath: `/tmp/${asset.index}.jpg`,
        sizeBytes: 100,
        contentType: "image/jpeg",
      }),
      async () => {},
    );

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/p/cleanup-context/"),
    );

    let failure: unknown;
    try {
      await collection.dispose();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INSTAGRAM_MEDIA_CLEANUP_FAILED",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "published_cleanup",
        mediaFailureClass: "storage",
        mediaIndex: 2,
        mediaKind: "image",
        mediaAttempt: 1,
        mediaMaxAttempts: 2,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private storage detail");
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
      createMediaStore(),
      async () => metadata,
      { retrieve: vi.fn() },
      assetDownloader,
      async () => {},
    );

    const collection = await retriever.retrieve(
      new URL("https://www.instagram.com/p/mixed/"),
    );
    expect(
      collection.items.map(({ index, kind }) => ({ index, kind })),
    ).toEqual([
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
      createMediaStore(),
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
      createMediaStore(),
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
      diagnostics: {
        mediaFailureStage: "metadata_probe",
        mediaFailureClass: "invalid_response",
        mediaAttempt: 1,
        mediaMaxAttempts: 2,
      },
    });
    expect(assetDownloader).not.toHaveBeenCalled();
  });

  it("normalizes work-directory creation failures without changing retryability", async () => {
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
      async () => ({
        entries: [
          {
            formats: [],
            thumbnails: [{ url: "https://cdn.example/1.jpg" }],
          },
        ],
      }),
      { retrieve: vi.fn() },
      vi.fn(),
      async () => {},
      undefined,
      async () => {
        throw new Error("private filesystem detail");
      },
    );

    let failure: unknown;
    try {
      await retriever.retrieve(
        new URL("https://www.instagram.com/p/no-temp-dir/"),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "local_prepare",
        mediaFailureClass: "filesystem",
        mediaAttempt: 1,
        mediaMaxAttempts: 2,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private filesystem detail");
  });

  it("preserves retryability when clearing a reused work directory fails", async () => {
    let downloadAttempt = 0;
    const rootPrefix = join(tmpdir(), "foodfolio-instagram-media-");
    const removeLocal = vi.fn(async (path: string, recursive: boolean) => {
      const suffix = path.startsWith(rootPrefix)
        ? path.slice(rootPrefix.length)
        : "";
      const isChildOfWorkDirectory =
        recursive && path.startsWith(rootPrefix) && suffix.includes("/");
      if (isChildOfWorkDirectory) throw new Error("private cleanup detail");
      if (recursive) {
        await rm(path, { recursive: true, force: true });
        return;
      }
      await rm(path, { force: true });
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
      async () => ({
        entries: [
          {
            formats: [],
            thumbnails: [{ url: "https://cdn.example/1.jpg" }],
          },
        ],
      }),
      { retrieve: vi.fn() },
      async (_asset, workDirectory) => {
        downloadAttempt += 1;
        const filePath = join(workDirectory, "partial.jpg");
        await writeFile(filePath, new Uint8Array([1]));
        throw new Error("download failed");
      },
      async () => {},
      removeLocal,
    );

    let failure: unknown;
    try {
      await retriever.retrieve(
        new URL("https://www.instagram.com/p/retry-cleanup/"),
      );
    } catch (error) {
      failure = error;
    }

    expect(downloadAttempt).toBe(1);
    expect(failure).toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "local_cleanup",
        mediaFailureClass: "filesystem",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private cleanup detail");
  });

  it("classifies work-directory removal failures as local cleanup", async () => {
    const metadata = {
      entries: [
        { formats: [], thumbnails: [{ url: "https://cdn.example/1.jpg" }] },
      ],
    };
    let rootRemovalFailures = 0;
    const rootPrefix = join(tmpdir(), "foodfolio-instagram-media-");
    const removeLocal = vi.fn(async (path: string, recursive: boolean) => {
      const suffix = path.startsWith(rootPrefix)
        ? path.slice(rootPrefix.length)
        : "";
      const isWorkDirectoryRoot =
        recursive && path.startsWith(rootPrefix) && !suffix.includes("/");
      if (isWorkDirectoryRoot && rootRemovalFailures < 2) {
        rootRemovalFailures += 1;
        throw new Error("filesystem cleanup failed");
      }
      if (recursive) {
        await rm(path, { recursive: true, force: true });
        return;
      }
      await rm(path, { force: true });
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
      async () => metadata,
      { retrieve: vi.fn() },
      async (asset, workDirectory) => {
        const filePath = join(workDirectory, `${asset.index}.jpg`);
        await writeFile(filePath, new Uint8Array([1]));
        return { filePath, sizeBytes: 1, contentType: "image/jpeg" };
      },
      async () => {},
      removeLocal,
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/p/cleanup/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      retryable: false,
      diagnostics: {
        mediaFailureStage: "local_cleanup",
        mediaFailureClass: "filesystem",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(rootRemovalFailures).toBe(2);
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
    const disposePublished = vi.fn(async () => {});
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(disposePublished),
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
      diagnostics: {
        mediaFailureStage: "asset_download",
        mediaFailureClass: "unknown",
        mediaIndex: 2,
        mediaKind: "image",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(assetDownloader).toHaveBeenCalledTimes(4);
    expect(disposePublished).toHaveBeenCalledTimes(2);
  });

  it("retries the whole carousel and cleans prior GCS objects when a publish fails", async () => {
    const metadata = {
      entries: [1, 2].map((index) => ({
        formats: [],
        thumbnails: [{ url: `https://cdn.example/${index}.jpg` }],
      })),
    };
    const disposePublished = vi.fn(async () => {});
    const mediaStore: TemporaryMediaStore = {
      publish: vi.fn(async (item) => {
        if (item.index === 2) throw new Error("GCS unavailable");
        return {
          url: `https://storage.example/${item.index}`,
          kind: item.kind,
          contentType: item.contentType,
          dispose: disposePublished,
        };
      }),
    };
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      mediaStore,
      async () => metadata,
      { retrieve: vi.fn() },
      async (asset) => ({
        filePath: `/tmp/${asset.index}.jpg`,
        sizeBytes: 100,
        contentType: "image/jpeg",
      }),
      async () => {},
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/p/images/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      retryable: false,
      diagnostics: {
        mediaFailureStage: "publish",
        mediaFailureClass: "unknown",
        mediaIndex: 2,
        mediaKind: "image",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(mediaStore.publish).toHaveBeenCalledTimes(4);
    expect(disposePublished).toHaveBeenCalledTimes(2);
  });

  it("classifies execFile-style metadata timeouts as timeouts", async () => {
    const metadataProbe = vi.fn(async () => {
      throw Object.assign(new Error("private process detail"), {
        code: null,
        killed: true,
        signal: "SIGKILL",
      });
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
      metadataProbe,
      { retrieve: vi.fn() },
      vi.fn(),
      async () => {},
    );

    let failure: unknown;
    try {
      await retriever.retrieve(new URL("https://www.instagram.com/p/timeout/"));
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INSTAGRAM_MEDIA_METADATA_FAILED",
      retryable: true,
      diagnostics: {
        mediaFailureStage: "metadata_probe",
        mediaFailureClass: "timeout",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private process detail");
  });

  it("maps repeated metadata probe failures to a retryable analysis error", async () => {
    const metadataProbe = vi.fn(async () => {
      throw new Error("yt-dlp failed");
    });
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
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
      diagnostics: {
        mediaFailureStage: "metadata_probe",
        mediaFailureClass: "tool_error",
        mediaAttempt: 2,
        mediaMaxAttempts: 2,
      },
    });
    expect(metadataProbe).toHaveBeenCalledTimes(2);
  });

  it("rejects non-Instagram URLs before probing metadata", async () => {
    const metadataProbe = vi.fn();
    const retriever = new YtDlpInstagramMediaRetriever(
      config,
      createMediaStore(),
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
              {
                url: "https://cdn.example/large.jpg",
                width: 1080,
                height: 1080,
              },
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
    const directory = await mkdtemp(
      join(tmpdir(), "foodfolio-test-instagram-"),
    );
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

  it("records HTTP status and asset position without logging the media URL", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "foodfolio-test-instagram-"),
    );
    temporaryDirectories.push(directory);
    const asset = {
      index: 2,
      kind: "image" as const,
      url: "https://cdn.example/private-photo.jpg?token=secret",
      httpHeaders: { Authorization: "Bearer secret" },
    };

    let failure: unknown;
    try {
      await downloadInstagramAsset(
        asset,
        directory,
        1_000,
        async () => new Response(null, { status: 503 }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      retryable: false,
      diagnostics: {
        mediaFailureStage: "asset_download",
        mediaFailureClass: "http_error",
        mediaHttpStatus: 503,
        mediaIndex: 2,
        mediaKind: "image",
      },
    });
    expect(JSON.stringify(failure)).not.toContain("private-photo");
    expect(JSON.stringify(failure)).not.toContain("Bearer secret");
  });

  it("rejects image formats the AI provider does not accept", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "foodfolio-test-instagram-"),
    );
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
