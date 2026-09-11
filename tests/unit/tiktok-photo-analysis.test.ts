import { describe, expect, it, vi } from "vitest";
import type {
  MediaRecipeExtractor,
  TemporaryMediaStore,
} from "../../src/application/analysis/types.js";
import { ProductionTikTokPhotoRecipeAnalysis } from "../../src/infrastructure/tiktok/tiktok-photo-recipe-analysis.js";

const recipeResult = {
  recipe: {
    title: "肉巻きポテト",
    servings: null,
    cookingTimeMinutes: null,
    genre: "主菜",
    ingredients: [{ name: "じゃがいも", amount: "2個" }],
    steps: ["豚肉で巻いて焼く"],
  },
  provider: "zai" as const,
  providerRequestId: "photo-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

describe("ProductionTikTokPhotoRecipeAnalysis", () => {
  it("analyzes the compacted successful subset once and cleans every published image", async () => {
    const disposed: number[] = [];
    let publishAttempt = 0;
    const publish = vi.fn<TemporaryMediaStore["publish"]>(async (media) => {
      publishAttempt += 1;
      if (publishAttempt === 2) throw new Error("publish failed");
      return {
        url: `https://signed.example/${media.index}`,
        kind: "image",
        contentType: media.contentType,
        dispose: async () => void disposed.push(media.index),
      };
    });
    const extractMedia = vi.fn<MediaRecipeExtractor["extractMedia"]>(
      async () => recipeResult,
    );
    const analysis = new ProductionTikTokPhotoRecipeAnalysis(
      { publish },
      { extractMedia },
      async (url) => {
        if (url.pathname.endsWith("2.jpg")) throw new Error("download failed");
        return { contentType: "image/jpeg", data: Buffer.from("photo") };
      },
    );

    await expect(
      analysis.extract({
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
        imageUrl: "https://images.example/1.jpg",
        textForAi: "DESCRIPTION\n肉巻きポテト #レシピ",
        tiktokMediaKind: "photo",
        tiktokPhotoImageUrls: [
          "https://images.example/1.jpg",
          "https://images.example/2.jpg",
          "https://images.example/3.jpg",
          "https://images.example/4.jpg",
        ],
      }),
    ).resolves.toEqual(recipeResult);

    expect(extractMedia).toHaveBeenCalledOnce();
    expect(extractMedia.mock.calls[0]?.[1].map(({ index }) => index)).toEqual([
      1, 2,
    ]);
    expect(disposed).toEqual([1, 2]);
  });

  it("fails without AI extraction when every image is unavailable", async () => {
    const extractMedia = vi.fn();
    const analysis = new ProductionTikTokPhotoRecipeAnalysis(
      { publish: vi.fn() },
      { extractMedia },
      async () => {
        throw new Error("download failed");
      },
    );

    await expect(
      analysis.extract({
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
        imageUrl: "https://images.example/1.jpg",
        textForAi: null,
        tiktokMediaKind: "photo",
        tiktokPhotoImageUrls: ["https://images.example/1.jpg"],
      }),
    ).rejects.toMatchObject({ code: "TIKTOK_PHOTO_MEDIA_UNAVAILABLE" });
    expect(extractMedia).not.toHaveBeenCalled();
  });

  it("cleans published images when Z.ai extraction fails", async () => {
    const dispose = vi.fn(async () => {});
    const analysis = new ProductionTikTokPhotoRecipeAnalysis(
      {
        publish: async (media) => ({
          url: "https://signed.example/1",
          kind: "image",
          contentType: media.contentType,
          dispose,
        }),
      },
      {
        extractMedia: async () => {
          throw new Error("provider failed");
        },
      },
      async () => ({
        contentType: "image/webp",
        data: Buffer.from("photo"),
      }),
    );

    await expect(
      analysis.extract({
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
        imageUrl: "https://images.example/1.webp",
        textForAi: "DESCRIPTION\n肉巻きポテト",
        tiktokMediaKind: "photo",
        tiktokPhotoImageUrls: ["https://images.example/1.webp"],
      }),
    ).rejects.toThrow("provider failed");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps a successful Z.ai result when GCS cleanup fails", async () => {
    const dispose = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const extractMedia = vi.fn<MediaRecipeExtractor["extractMedia"]>(
      async () => recipeResult,
    );
    const analysis = new ProductionTikTokPhotoRecipeAnalysis(
      {
        publish: async (media) => ({
          url: "https://signed.example/1",
          kind: "image",
          contentType: media.contentType,
          dispose,
        }),
      },
      { extractMedia },
      async () => ({
        contentType: "image/jpeg",
        data: Buffer.from("photo"),
      }),
    );

    await expect(
      analysis.extract({
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
        imageUrl: "https://images.example/1.jpg",
        textForAi: "DESCRIPTION\n肉巻きポテト",
        tiktokMediaKind: "photo",
        tiktokPhotoImageUrls: ["https://images.example/1.jpg"],
      }),
    ).resolves.toEqual(recipeResult);
    expect(extractMedia).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
