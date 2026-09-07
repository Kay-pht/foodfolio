import { describe, expect, it, vi } from "vitest";
import type {
  MediaRetriever,
  TemporaryMediaStore,
  VideoRecipeExtractor,
} from "../../src/application/analysis/types.js";
import { ProductionInstagramVideoRecipeFallback } from "../../src/infrastructure/instagram/instagram-video-recipe-fallback.js";

const source = {
  sourceType: "instagram" as const,
  resolvedUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
  imageUrl: null,
  textForAi: "DESCRIPTION\nパスタ",
};

const extraction = {
  recipe: {
    title: "パスタ",
    servings: null,
    cookingTimeMinutes: null,
    genre: "麺",
    ingredients: [{ name: "パスタ", amount: "100g" }],
    steps: ["茹でる"],
  },
  provider: "zai" as const,
  providerRequestId: "video-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

describe("ProductionInstagramVideoRecipeFallback", () => {
  it("publishes the common video item, analyzes it, and cleans up both copies", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const video = {
      index: 1,
      kind: "video" as const,
      filePath: "/tmp/video.mp4",
      sizeBytes: 123,
      contentType: "video/mp4",
    };
    const mediaRetriever: MediaRetriever = {
      retrieve: vi.fn(async () => ({
        items: [video],
        attempts: 2,
        dispose: disposeDownload,
      })),
    };
    const mediaStore: TemporaryMediaStore = {
      publish: vi.fn(async () => ({
        url: "https://storage.example/signed-video",
        kind: "video",
        contentType: "video/mp4",
        dispose: disposePublished,
      })),
    };
    const recipeExtractor: VideoRecipeExtractor = {
      extractVideo: vi.fn(async () => extraction),
    };
    const fallback = new ProductionInstagramVideoRecipeFallback(
      mediaRetriever,
      mediaStore,
      recipeExtractor,
    );

    await expect(fallback.extract(source)).resolves.toEqual(extraction);
    expect(mediaStore.publish).toHaveBeenCalledWith(video);
    expect(recipeExtractor.extractVideo).toHaveBeenCalledWith(
      source,
      "https://storage.example/signed-video",
    );
    expect(disposePublished).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("cleans up local and GCS media when AI video analysis fails", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const fallback = new ProductionInstagramVideoRecipeFallback(
      {
        retrieve: async () => ({
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
          dispose: disposeDownload,
        }),
      },
      {
        publish: async () => ({
          url: "https://storage.example/signed-video",
          kind: "video",
          contentType: "video/mp4",
          dispose: disposePublished,
        }),
      },
      {
        extractVideo: async () => {
          throw new Error("provider failed");
        },
      },
    );

    await expect(fallback.extract(source)).rejects.toThrow("provider failed");
    expect(disposePublished).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("cleans up and rejects a non-single-video collection", async () => {
    const disposeDownload = vi.fn(async () => {});
    const fallback = new ProductionInstagramVideoRecipeFallback(
      {
        retrieve: async () => ({
          items: [],
          attempts: 1,
          dispose: disposeDownload,
        }),
      },
      {
        publish: vi.fn(),
      },
      {
        extractVideo: vi.fn(),
      },
    );

    await expect(fallback.extract(source)).rejects.toMatchObject({
      code: "INSTAGRAM_VIDEO_MEDIA_INVALID",
      retryable: false,
    });
    expect(disposeDownload).toHaveBeenCalledOnce();
  });
});
