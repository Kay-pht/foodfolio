import { describe, expect, it, vi } from "vitest";
import type {
  MediaRecipeExtractor,
  PublishedMediaRetriever,
} from "../../src/application/analysis/types.js";
import { ProductionInstagramMediaRecipeFallback } from "../../src/infrastructure/instagram/instagram-media-recipe-fallback.js";

const source = {
  sourceType: "instagram" as const,
  resolvedUrl: "https://www.instagram.com/p/example/",
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
  providerRequestId: "media-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

const publishedItems = [
  {
    index: 1,
    kind: "image" as const,
    url: "https://storage.example/1.jpg",
    contentType: "image/jpeg",
    dispose: async () => {},
  },
  {
    index: 2,
    kind: "video" as const,
    url: "https://storage.example/2.mp4",
    contentType: "video/mp4",
    dispose: async () => {},
  },
];

describe("ProductionInstagramMediaRecipeFallback", () => {
  it("analyzes the complete published collection in post order and cleans up", async () => {
    const dispose = vi.fn(async () => {});
    const mediaRetriever: PublishedMediaRetriever = {
      retrieve: vi.fn(async () => ({
        items: publishedItems,
        attempts: 1,
        dispose,
      })),
    };
    const extractMedia = vi.fn(async () => extraction);
    const recipeExtractor: MediaRecipeExtractor = { extractMedia };
    const fallback = new ProductionInstagramMediaRecipeFallback(
      mediaRetriever,
      recipeExtractor,
    );

    await expect(fallback.extract(source)).resolves.toEqual(extraction);
    expect(extractMedia).toHaveBeenCalledWith(source, publishedItems);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cleans every published object when multimodal AI analysis fails", async () => {
    const dispose = vi.fn(async () => {});
    const fallback = new ProductionInstagramMediaRecipeFallback(
      {
        retrieve: async () => ({
          items: [publishedItems[0]!],
          attempts: 1,
          dispose,
        }),
      },
      {
        extractMedia: async () => {
          throw new Error("provider failed");
        },
      },
    );

    await expect(fallback.extract(source)).rejects.toThrow("provider failed");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects a collection with a missing index instead of partially analyzing it", async () => {
    const dispose = vi.fn(async () => {});
    const fallback = new ProductionInstagramMediaRecipeFallback(
      {
        retrieve: async () => ({
          items: [{ ...publishedItems[1]!, index: 2 }],
          attempts: 1,
          dispose,
        }),
      },
      { extractMedia: vi.fn() },
    );

    await expect(fallback.extract(source)).rejects.toMatchObject({
      code: "INSTAGRAM_MEDIA_COLLECTION_INVALID",
      retryable: false,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
