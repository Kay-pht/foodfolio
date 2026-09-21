import { describe, expect, it, vi } from "vitest";
import type {
  RecipeExtractionResult,
  RecipeExtractor,
  SourceContent,
} from "../../src/application/analysis/types.js";
import { YoutubeAwareRecipeExtractor } from "../../src/application/analysis/youtube-aware-recipe-extractor.js";

const recipeResult = (provider: "zai" | "gemini"): RecipeExtractionResult => ({
  recipe: {
    title: "豚バラ白菜",
    servings: { value: 2, raw: "2人分" },
    cookingTimeMinutes: 15,
    genre: "主菜",
    ingredients: [{ name: "豚バラ肉", amount: "200g" }],
    steps: ["炒める"],
  },
  provider,
  providerRequestId: `${provider}-request`,
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 1,
});

const youtubeSource = (description: string): SourceContent => ({
  sourceType: "youtube",
  resolvedUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
  imageUrl: null,
  textForAi: `TITLE\n豚バラ白菜\n\nDESCRIPTION\n${description}`,
  youtubeDescription: description,
});

describe("YoutubeAwareRecipeExtractor", () => {
  it("calls Z.ai once and never Gemini for a sufficient description", async () => {
    const extractZai = vi.fn(async () => recipeResult("zai"));
    const extractGemini = vi.fn(async () => recipeResult("gemini"));
    const router = new YoutubeAwareRecipeExtractor(
      { extract: extractZai },
      { extract: extractGemini },
    );
    const description =
      "材料\n豚肉 200g\n白菜 1/4個\n作り方\n1. 白菜を切る\n2. 豚肉を炒める";

    await expect(
      router.extract(youtubeSource(description)),
    ).resolves.toMatchObject({
      provider: "zai",
    });
    expect(extractZai).toHaveBeenCalledOnce();
    expect(extractGemini).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "料理の概要だけです",
    "材料\n豚肉 200g\n白菜 1/4個",
    "作り方\n1. 白菜を切る\n2. 豚肉を炒める",
    "登録はこちら\nhttps://example.com",
    "材料\n豚肉 200g\n白菜 1/4個\n詳しくは動画をご覧ください",
  ])(
    "calls Gemini once and never Z.ai for insufficient input: %s",
    async (description) => {
      const extractZai = vi.fn(async () => recipeResult("zai"));
      const extractGemini = vi.fn(async () => recipeResult("gemini"));
      const router = new YoutubeAwareRecipeExtractor(
        { extract: extractZai },
        { extract: extractGemini },
      );

      await expect(
        router.extract(youtubeSource(description)),
      ).resolves.toMatchObject({
        provider: "gemini",
      });
      expect(extractGemini).toHaveBeenCalledOnce();
      expect(extractZai).not.toHaveBeenCalled();
    },
  );

  it.each(["web", "instagram", "tiktok"] as const)(
    "keeps the existing Z.ai path for %s",
    async (sourceType) => {
      const extractZai = vi.fn(async () => recipeResult("zai"));
      const extractGemini = vi.fn(async () => recipeResult("gemini"));
      const router = new YoutubeAwareRecipeExtractor(
        { extract: extractZai } satisfies RecipeExtractor,
        { extract: extractGemini },
      );

      await router.extract({
        sourceType,
        resolvedUrl: "https://example.com/recipe",
        imageUrl: null,
        textForAi: "recipe",
      });
      expect(extractZai).toHaveBeenCalledOnce();
      expect(extractGemini).not.toHaveBeenCalled();
    },
  );

  it("keeps the legacy fail-open route for sufficient descriptions with incomplete Z.ai output", async () => {
    const incomplete = recipeResult("zai");
    incomplete.recipe.steps = [];
    const extractZai = vi.fn(async () => incomplete);
    const extractGemini = vi.fn(async () => recipeResult("gemini"));
    const router = new YoutubeAwareRecipeExtractor(
      { extract: extractZai },
      { extract: extractGemini },
    );
    const description =
      "材料\n豚肉 200g\n白菜 1/4個\n作り方\n1. 白菜を切る\n2. 豚肉を炒める";

    await expect(router.extract(youtubeSource(description))).rejects.toMatchObject({
      code: "AI_RECIPE_INCOMPLETE",
      retryable: true,
      provider: "zai",
    });
    expect(extractZai).toHaveBeenCalledOnce();
    expect(extractGemini).not.toHaveBeenCalled();
  });

  it("returns a distinct error when Gemini fallback is disabled", async () => {
    const router = new YoutubeAwareRecipeExtractor(
      { extract: async () => recipeResult("zai") },
      null,
    );
    await expect(
      router.extract(youtubeSource("概要だけ")),
    ).rejects.toMatchObject({
      code: "YOUTUBE_GEMINI_FALLBACK_DISABLED",
      retryable: false,
    });
  });
});
