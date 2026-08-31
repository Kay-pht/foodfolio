import { describe, expect, it, vi } from "vitest";
import type {
  TemporaryVideoStore,
  TikTokVideoDownloader,
  VideoRecipeExtractor,
} from "../../src/application/analysis/types.js";
import { ProductionTikTokVideoRecipeFallback } from "../../src/infrastructure/tiktok/tiktok-video-recipe-fallback.js";

const source = {
  sourceType: "tiktok" as const,
  resolvedUrl: "https://www.tiktok.com/@chef/video/123",
  imageUrl: null,
  textForAi: "TITLE\nパスタ",
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
  providerRequestId: "video-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

describe("ProductionTikTokVideoRecipeFallback", () => {
  it("publishes the downloaded file, analyzes it, and deletes both copies", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const downloader: TikTokVideoDownloader = {
      download: vi.fn(async () => ({
        filePath: "/tmp/video.mp4",
        sizeBytes: 123,
        attempts: 2,
        dispose: disposeDownload,
      })),
    };
    const videoStore: TemporaryVideoStore = {
      publish: vi.fn(async () => ({
        url: "https://storage.example/signed-video",
        dispose: disposePublished,
      })),
    };
    const recipeExtractor: VideoRecipeExtractor = {
      extractVideo: vi.fn(async () => extraction),
    };

    const fallback = new ProductionTikTokVideoRecipeFallback(
      downloader,
      videoStore,
      recipeExtractor,
    );

    await expect(fallback.extract(source)).resolves.toEqual(extraction);
    expect(videoStore.publish).toHaveBeenCalledWith("/tmp/video.mp4");
    expect(recipeExtractor.extractVideo).toHaveBeenCalledWith(
      source,
      "https://storage.example/signed-video",
    );
    expect(disposePublished).toHaveBeenCalledOnce();
    expect(disposeDownload).toHaveBeenCalledOnce();
  });

  it("deletes temporary files even when video analysis fails", async () => {
    const disposeDownload = vi.fn(async () => {});
    const disposePublished = vi.fn(async () => {});
    const fallback = new ProductionTikTokVideoRecipeFallback(
      {
        download: async () => ({
          filePath: "/tmp/video.mp4",
          sizeBytes: 123,
          attempts: 1,
          dispose: disposeDownload,
        }),
      },
      {
        publish: async () => ({
          url: "https://storage.example/signed-video",
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
});
