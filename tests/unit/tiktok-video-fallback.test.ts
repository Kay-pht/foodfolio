import { describe, expect, it, vi } from "vitest";
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
  provider: "zai",
  providerRequestId: "video-request",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
};

describe("ProductionTikTokVideoRecipeFallback", () => {
  it.each([false, true])(
    "disposes the published video when analysis fails=%s",
    async (failure) => {
      const dispose = vi.fn(async () => {});
      const publish = vi.fn(async () => ({
        url: "https://storage.example/signed-video",
        kind: "video" as const,
        contentType: "video/mp4",
        dispose,
      }));
      const extractVideo = vi.fn(async () => {
        if (failure) throw new Error("provider failed");
        return extraction;
      });
      const fallback = new ProductionTikTokVideoRecipeFallback(publish, {
        extractVideo,
      });
      if (failure) {
        await expect(fallback.extract(source)).rejects.toThrow(
          "provider failed",
        );
      } else {
        await expect(fallback.extract(source)).resolves.toEqual(extraction);
      }
      expect(publish).toHaveBeenCalledWith(new URL(source.resolvedUrl));
      expect(extractVideo).toHaveBeenCalledWith(
        source,
        "https://storage.example/signed-video",
      );
      expect(dispose).toHaveBeenCalledOnce();
    },
  );
});
