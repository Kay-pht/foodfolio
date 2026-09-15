import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import type {
  GeneratedRecipeImageStore,
  NotificationSender,
  RecipeExtractor,
  RecipeThumbnailGenerator,
  SourceContentExtractor,
} from "../../src/application/analysis/types.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const aiSharedSource: SourceContentExtractor = {
  extract: async () => ({
    sourceType: "chatgpt",
    resolvedUrl: "https://chatgpt.com/share/thumbnail-e2e",
    imageUrl: null,
    textForAi: "User: 鶏の照り焼きのレシピを教えて",
  }),
};

const completeRecipeExtractor: RecipeExtractor = {
  extract: async () => ({
    recipe: {
      title: "鶏の照り焼き",
      servings: { value: 2, raw: "2人分" },
      cookingTimeMinutes: 20,
      genre: "主菜",
      ingredients: [{ name: "鶏もも肉", amount: "300g" }],
      steps: ["鶏肉を焼く", "たれを絡める"],
    },
    provider: "zai",
    providerRequestId: "zai-thumbnail-e2e",
    inputTokens: 10,
    outputTokens: 20,
    latencyMs: 30,
  }),
};

class NoopNotifications implements NotificationSender {
  async sendRecipeAnalysisCompleted() {
    return [];
  }
  async sendRecipeAnalysisFailed() {
    return [];
  }
}

const generatedImage = {
  data: new Uint8Array([1, 2, 3]),
  contentType: "image/webp",
  extension: "webp",
};

describe("AI shared recipe thumbnail E2E", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  async function createRecipe(suffix: string) {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: `thumbnail-${suffix}`,
        setting: { create: { recipeAnalysisNotificationEnabled: false } },
      },
    });
    return context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: `https://chatgpt.com/share/${suffix}`,
        normalizedUrl: `https://chatgpt.com/share/${suffix}`,
        sourceType: "chatgpt",
      },
    });
  }

  it("persists a generated public image URL after successful AI shared recipe extraction", async () => {
    const recipe = await createRecipe("success");
    const generator: RecipeThumbnailGenerator = {
      generate: vi.fn(async () => generatedImage),
    };
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(
        async (recipeId) =>
          `https://storage.googleapis.com/generated/recipe-images/${recipeId}/image.webp`,
      ),
      owns: () => true,
      deleteForRecipe: vi.fn(async () => {}),
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: aiSharedSource,
      recipeExtractor: completeRecipeExtractor,
      recipeThumbnailGenerator: generator,
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.imageUrl).toBe(
      `https://storage.googleapis.com/generated/recipe-images/${recipe.id}/image.webp`,
    );
    expect(generator.generate).toHaveBeenCalledOnce();
  });

  it("keeps the Recipe processing until best-effort thumbnail generation settles", async () => {
    const recipe = await createRecipe("processing-until-thumbnail");
    let releaseGeneration: (() => void) | undefined;
    let markGenerationStarted: (() => void) | undefined;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationReleased = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(
        async (recipeId) =>
          `https://storage.googleapis.com/generated/recipe-images/${recipeId}/image.webp`,
      ),
      owns: () => true,
      deleteForRecipe: vi.fn(async () => {}),
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: aiSharedSource,
      recipeExtractor: completeRecipeExtractor,
      recipeThumbnailGenerator: {
        generate: async () => {
          markGenerationStarted?.();
          await generationReleased;
          return generatedImage;
        },
      },
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    const processing = service.process(recipe.id, 1, vi.fn());
    await generationStarted;

    const duringGeneration = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(duringGeneration.analysisStatus).toBe("processing");
    expect(duringGeneration.processingRunId).not.toBeNull();
    expect(duringGeneration.processingLeaseExpiresAt).not.toBeNull();
    expect(duringGeneration.imageUrl).toBeNull();
    expect(duringGeneration.ingredients).toHaveLength(1);
    expect(duringGeneration.steps).toHaveLength(2);

    releaseGeneration?.();
    await expect(processing).resolves.toEqual({ retry: false });

    const completed = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(completed.analysisStatus).toBe("completed");
    expect(completed.processingRunId).toBeNull();
    expect(completed.processingLeaseExpiresAt).toBeNull();
    expect(completed.imageUrl).toBe(
      `https://storage.googleapis.com/generated/recipe-images/${recipe.id}/image.webp`,
    );
  });

  it("keeps a successfully extracted recipe completed when thumbnail generation fails", async () => {
    const recipe = await createRecipe("generation-failure");
    const generator: RecipeThumbnailGenerator = {
      generate: async () => {
        throw new Error("OpenAI unavailable");
      },
    };
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(async () => "https://storage.example/unused.webp"),
      owns: () => true,
      deleteForRecipe: vi.fn(async () => {}),
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: aiSharedSource,
      recipeExtractor: completeRecipeExtractor,
      recipeThumbnailGenerator: generator,
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.imageUrl).toBeNull();
    expect(store.publish).not.toHaveBeenCalled();
  });

  it("removes generated objects when the Recipe disappears before imageUrl persistence", async () => {
    const recipe = await createRecipe("concurrent-delete");
    const deleteForRecipe = vi.fn(async () => {});
    const store: GeneratedRecipeImageStore = {
      publish: vi.fn(async (recipeId) => {
        await context.prisma.recipe.delete({ where: { id: recipeId } });
        return `https://storage.googleapis.com/generated/recipe-images/${recipeId}/image.webp`;
      }),
      owns: () => true,
      deleteForRecipe,
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: aiSharedSource,
      recipeExtractor: completeRecipeExtractor,
      recipeThumbnailGenerator: { generate: async () => generatedImage },
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(
      await context.prisma.recipe.findUnique({ where: { id: recipe.id } }),
    ).toBeNull();
    expect(deleteForRecipe).toHaveBeenCalledWith(recipe.id);
  });
});
