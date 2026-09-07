import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import type {
  InstagramVideoRecipeFallback,
  NotificationSender,
  RecipeExtractor,
  SourceContentExtractor,
} from "../../src/application/analysis/types.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

class NoopNotifications implements NotificationSender {
  async sendRecipeAnalysisCompleted() {
    return [];
  }
  async sendRecipeAnalysisFailed() {
    return [];
  }
}

const completeVideoResult = {
  recipe: {
    title: "絶品パスタ",
    servings: { value: 1, raw: "1人分" },
    cookingTimeMinutes: 15,
    genre: "麺",
    ingredients: [{ name: "パスタ", amount: "100g" }],
    steps: ["パスタを茹でる"],
  },
  provider: "zai" as const,
  providerRequestId: "instagram-video-request",
  inputTokens: 30,
  outputTokens: 40,
  latencyMs: 50,
};

describe("Instagram video analysis integration", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("uses video fallback only after metadata extraction is incomplete", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "instagram-video-fallback-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
        normalizedUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
        sourceType: "instagram",
      },
    });
    const sourceExtractor: SourceContentExtractor = {
      extract: async () => ({
        sourceType: "instagram",
        resolvedUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
        imageUrl: "https://images.example/instagram.jpg",
        textForAi: "DESCRIPTION\n絶品パスタ",
      }),
    };
    const metadataExtractor: RecipeExtractor = {
      extract: async () => ({
        recipe: {
          title: "絶品パスタ",
          servings: null,
          cookingTimeMinutes: null,
          genre: "麺",
          ingredients: [],
          steps: [],
        },
        provider: "zai",
        providerRequestId: "instagram-metadata-request",
        inputTokens: 3,
        outputTokens: 4,
        latencyMs: 5,
      }),
    };
    const extractVideo = vi.fn(async () => completeVideoResult);
    const instagramVideoFallback: InstagramVideoRecipeFallback = {
      extract: extractVideo,
    };
    const log = vi.fn();
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor,
      recipeExtractor: metadataExtractor,
      instagramVideoFallback,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, log)).resolves.toEqual({
      retry: false,
    });
    expect(extractVideo).toHaveBeenCalledOnce();
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.steps).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        videoFallbackUsed: true,
        inputTokens: 33,
        outputTokens: 44,
        latencyMs: 55,
      }),
      "recipe analysis completed",
    );
  });

  it("does not retrieve video when Instagram metadata already contains a complete recipe", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "instagram-metadata-complete-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.instagram.com/p/aye83DjauH/",
        normalizedUrl: "https://www.instagram.com/p/aye83DjauH/",
        sourceType: "instagram",
      },
    });
    const extractVideo = vi.fn();
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "instagram",
          resolvedUrl: "https://www.instagram.com/p/aye83DjauH/",
          imageUrl: null,
          textForAi: "DESCRIPTION\n材料 パスタ100g 作り方 茹でる",
        }),
      },
      recipeExtractor: {
        extract: async () => completeVideoResult,
      },
      instagramVideoFallback: { extract: extractVideo },
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(extractVideo).not.toHaveBeenCalled();
  });

  it("skips text AI and falls back directly when Instagram metadata text is absent", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "instagram-metadata-empty-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.instagram.com/reel/empty/",
        normalizedUrl: "https://www.instagram.com/reel/empty/",
        sourceType: "instagram",
      },
    });
    const extractText = vi.fn();
    const extractVideo = vi.fn(async () => completeVideoResult);
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "instagram",
          resolvedUrl: "https://www.instagram.com/reel/empty/",
          imageUrl: null,
          textForAi: null,
        }),
      },
      recipeExtractor: { extract: extractText },
      instagramVideoFallback: { extract: extractVideo },
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(extractText).not.toHaveBeenCalled();
    expect(extractVideo).toHaveBeenCalledOnce();
  });
});
