import { describe, expect, it, vi } from "vitest";
import type {
  MediaCollection,
  MediaRetriever,
} from "../../src/application/analysis/types.js";
import { YtDlpInstagramVideoRetriever } from "../../src/infrastructure/instagram/yt-dlp-instagram-video-retriever.js";

const config = {
  binaryPath: "/usr/local/bin/yt-dlp",
  maxAttempts: 3,
  attemptTimeoutMs: 45_000,
  retryBaseSeconds: 2,
  maxRetrySeconds: 10,
};

const collection: MediaCollection = {
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

describe("YtDlpInstagramVideoRetriever", () => {
  it.each([
    "https://www.instagram.com/reel/Chunk8-jurw/",
    "https://www.instagram.com/p/aye83DjauH/",
  ])("accepts a single-video Instagram post: %s", async (url) => {
    const metadataProbe = vi.fn(async () => ({
      formats: [
        {
          url: "https://cdn.example/video.mp4",
          width: 1080,
          height: 1920,
        },
      ],
    }));
    const mediaRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => collection),
    };
    const retriever = new YtDlpInstagramVideoRetriever(
      config,
      metadataProbe,
      mediaRetriever,
    );

    await expect(retriever.retrieve(new URL(url))).resolves.toBe(collection);
    expect(metadataProbe).toHaveBeenCalledWith(
      config.binaryPath,
      url,
      config.attemptTimeoutMs,
    );
    expect(mediaRetriever.retrieve).toHaveBeenCalledWith(new URL(url));
  });

  it.each([
    [
      "single image",
      {
        formats: [],
        thumbnails: [{ url: "https://cdn.example/image.jpg" }],
      },
    ],
    [
      "carousel",
      {
        entries: [
          { formats: [], thumbnails: [{ url: "https://cdn.example/1.jpg" }] },
          {
            formats: [{ url: "https://cdn.example/2.mp4", width: 1080 }],
          },
        ],
      },
    ],
  ])(
    "rejects %s so PR2 never partially analyzes it",
    async (_name, metadata) => {
      const mediaRetriever: MediaRetriever = {
        retrieve: vi.fn(async () => collection),
      };
      const retriever = new YtDlpInstagramVideoRetriever(
        config,
        async () => metadata,
        mediaRetriever,
      );

      await expect(
        retriever.retrieve(new URL("https://www.instagram.com/p/example/")),
      ).rejects.toMatchObject({
        code: "INSTAGRAM_VIDEO_UNSUPPORTED_MEDIA",
        retryable: false,
      });
      expect(mediaRetriever.retrieve).not.toHaveBeenCalled();
    },
  );

  it("maps metadata probe failures to a retryable analysis error", async () => {
    const mediaRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => collection),
    };
    const retriever = new YtDlpInstagramVideoRetriever(
      config,
      async () => {
        throw new Error("yt-dlp failed");
      },
      mediaRetriever,
    );

    await expect(
      retriever.retrieve(new URL("https://www.instagram.com/reel/example/")),
    ).rejects.toMatchObject({
      code: "INSTAGRAM_VIDEO_METADATA_FAILED",
      retryable: true,
    });
    expect(mediaRetriever.retrieve).not.toHaveBeenCalled();
  });

  it("rejects non-Instagram URLs before probing metadata", async () => {
    const metadataProbe = vi.fn();
    const mediaRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => collection),
    };
    const retriever = new YtDlpInstagramVideoRetriever(
      config,
      metadataProbe,
      mediaRetriever,
    );

    await expect(
      retriever.retrieve(new URL("https://example.com/reel/123")),
    ).rejects.toMatchObject({ code: "INSTAGRAM_VIDEO_URL_INVALID" });
    expect(metadataProbe).not.toHaveBeenCalled();
    expect(mediaRetriever.retrieve).not.toHaveBeenCalled();
  });
});
