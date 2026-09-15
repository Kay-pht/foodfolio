import { describe, expect, it, vi } from "vitest";
import {
  generateAiSharedRecipeThumbnail,
  hasRequiredRecipeContent,
  shouldGenerateAiSharedRecipeThumbnail,
} from "../../src/application/analysis/recipe-thumbnail.js";
import type {
  GeneratedRecipeImageStore,
  RecipeExtractionResult,
  RecipeThumbnailGenerator,
  SourceContent,
} from "../../src/application/analysis/types.js";

const result = (
  overrides: Partial<RecipeExtractionResult["recipe"]> = {},
): RecipeExtractionResult => ({
  recipe: {
    title: "鶏の照り焼き",
    servings: null,
    cookingTimeMinutes: 20,
    genre: "主菜",
    ingredients: [{ name: "鶏もも肉", amount: "300g" }],
    steps: ["焼く", "たれを絡める"],
    ...overrides,
  },
  provider: "zai",
  providerRequestId: "request-1",
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 30,
});

const source = (overrides: Partial<SourceContent> = {}): SourceContent => ({
  sourceType: "chatgpt",
  resolvedUrl: "https://chatgpt.com/share/example",
  imageUrl: null,
  textForAi: "transcript",
  ...overrides,
});

describe("AI shared recipe thumbnail policy", () => {
  it("reuses the existing ingredients-and-steps completeness rule", () => {
    expect(hasRequiredRecipeContent(result())).toBe(true);
    expect(hasRequiredRecipeContent(result({ ingredients: [] }))).toBe(false);
    expect(hasRequiredRecipeContent(result({ steps: [] }))).toBe(false);
  });

  it.each(["chatgpt", "gemini"] as const)(
    "generates for complete %s shared recipes without an existing image",
    (sourceType) => {
      expect(
        shouldGenerateAiSharedRecipeThumbnail(source({ sourceType }), result()),
      ).toBe(true);
    },
  );

  it("does not generate for other sources, incomplete recipes, or existing images", () => {
    expect(
      shouldGenerateAiSharedRecipeThumbnail(
        source({ sourceType: "web" }),
        result(),
      ),
    ).toBe(false);
    expect(
      shouldGenerateAiSharedRecipeThumbnail(
        source(),
        result({ ingredients: [] }),
      ),
    ).toBe(false);
    expect(
      shouldGenerateAiSharedRecipeThumbnail(source(), result({ steps: [] })),
    ).toBe(false);
    expect(
      shouldGenerateAiSharedRecipeThumbnail(
        source({ imageUrl: "https://example.com/source.jpg" }),
        result(),
      ),
    ).toBe(false);
  });
});

describe("generateAiSharedRecipeThumbnail", () => {
  const image = {
    data: new Uint8Array([1, 2, 3]),
    contentType: "image/webp",
    extension: "webp",
  };

  it("publishes the generated image and returns its public URL", async () => {
    const generator: RecipeThumbnailGenerator = {
      generate: vi.fn(async () => image),
    };
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(async () => "https://storage.example/generated.webp"),
      owns: vi.fn(() => true),
      deleteForRecipe: vi.fn(async () => {}),
    };
    const log = vi.fn();

    await expect(
      generateAiSharedRecipeThumbnail({
        recipeId: "recipe-1",
        source: source(),
        result: result(),
        generator,
        store,
        log,
      }),
    ).resolves.toBe("https://storage.example/generated.webp");
    expect(generator.generate).toHaveBeenCalledWith(result().recipe);
    expect(store.publish).toHaveBeenCalledWith("recipe-1", image);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the recipe image null when generation fails", async () => {
    const generator: RecipeThumbnailGenerator = {
      generate: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(async () => "https://storage.example/generated.webp"),
      owns: vi.fn(() => true),
      deleteForRecipe: vi.fn(async () => {}),
    };
    const log = vi.fn();

    await expect(
      generateAiSharedRecipeThumbnail({
        recipeId: "recipe-1",
        source: source(),
        result: result(),
        generator,
        store,
        log,
      }),
    ).resolves.toBeNull();
    expect(store.publish).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: "recipe-1",
        errorCode: "AI_SHARED_THUMBNAIL_GENERATION_FAILED",
      }),
      "AI shared recipe thumbnail generation failed",
    );
  });

  it("keeps the recipe image null when publishing fails", async () => {
    const generator: RecipeThumbnailGenerator = {
      generate: vi.fn(async () => image),
    };
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      owns: vi.fn(() => true),
      deleteForRecipe: vi.fn(async () => {}),
    };

    await expect(
      generateAiSharedRecipeThumbnail({
        recipeId: "recipe-1",
        source: source(),
        result: result(),
        generator,
        store,
        log: vi.fn(),
      }),
    ).resolves.toBeNull();
  });

  it("skips generation when optional thumbnail dependencies are not configured", async () => {
    await expect(
      generateAiSharedRecipeThumbnail({
        recipeId: "recipe-1",
        source: source(),
        result: result(),
        log: vi.fn(),
      }),
    ).resolves.toBeNull();
  });
});
