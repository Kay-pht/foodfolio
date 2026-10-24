import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import type { RecipeExtractionResult } from "../../src/application/analysis/types.js";
import { posts, setup } from "../helpers/tiktok-thumbnail.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

describe("TikTok missing oEmbed thumbnail worker E2E (TVT-1, TVT-3)", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it.each([
    { post: posts[0]!, fail: false },
    { post: posts[1]!, fail: false },
    { post: posts[0]!, fail: true },
  ])(
    "persists complete recipe and optional cover: %j",
    async ({ post, fail }) => {
      const user = await context.prisma.user.create({
        data: {
          firebaseUid: `tiktok-${post.id}-${fail}`,
          setting: { create: { recipeAnalysisNotificationEnabled: false } },
        },
      });
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: post.short,
          normalizedUrl: post.short,
          sourceType: "tiktok",
        },
      });
      const result: RecipeExtractionResult = {
        recipe: {
          title: "料理",
          ingredients: [{ name: "卵", amount: "1個" }],
          steps: ["卵を加熱する"],
          servings: null,
          cookingTimeMinutes: null,
          genre: null,
        },
        provider: "zai",
        providerRequestId: null,
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 30,
      };
      const { extractor } = setup({ fail }, post);
      const service = new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: extractor,
        recipeExtractor: {
          extract: vi.fn(async () => {
            throw new Error("No text metadata should be analyzed");
          }),
        },
        tiktokVideoFallback: { extract: vi.fn(async () => result) },
        notifications: {
          sendRecipeAnalysisCompleted: async () => [],
          sendRecipeAnalysisFailed: async () => [],
        },
        maxAttempts: 3,
      });
      await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
        retry: false,
      });
      const saved = await context.prisma.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        include: { ingredients: true, steps: true },
      });
      expect(saved.analysisStatus).toBe("completed");
      expect(saved.imageUrl).toBe(
        fail ? null : `https://images.example/${post.id}.jpg`,
      );
      expect(saved.ingredients).toMatchObject([{ name: "卵", amount: "1個" }]);
      expect(saved.steps).toMatchObject([{ text: "卵を加熱する" }]);
    },
  );
});
