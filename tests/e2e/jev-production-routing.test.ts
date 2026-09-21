import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import {
  JevRecipeRouter,
  normalizeJevInput,
  type JevRoutingThresholds,
} from "../../src/application/analysis/jev-routing.js";
import {
  AnalysisError,
  RecipeContentClassifierError,
  type NotificationSender,
  type RecipeContentClassification,
  type RecipeContentClassifier,
  type RecipeExtractionResult,
  type SourceContent,
} from "../../src/application/analysis/types.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const thresholds: JevRoutingThresholds = {
  generalWebNonRecipe: 0.8,
  youtubeRecipe: 0.99,
  instagramRecipe: 0.99,
  tiktokVideoRecipe: 0.99,
  tiktokPhotoRecipe: 0.99,
  aiChatNonRecipe: 0.99,
};

const completeResult = (
  provider: "zai" | "gemini" = "zai",
): RecipeExtractionResult => ({
  recipe: {
    title: "テスト料理",
    servings: { value: 2, raw: "2人分" },
    cookingTimeMinutes: 10,
    genre: "主菜",
    ingredients: [{ name: "食材", amount: "1個" }],
    steps: ["調理する"],
  },
  provider,
  providerRequestId: `${provider}-request`,
  inputTokens: 10,
  outputTokens: 5,
  latencyMs: 20,
});

const incompleteResult = (): RecipeExtractionResult => ({
  ...completeResult("zai"),
  recipe: {
    ...completeResult("zai").recipe,
    steps: [],
  },
});

class NoopNotifications implements NotificationSender {
  async sendRecipeAnalysisCompleted() {
    return [];
  }
  async sendRecipeAnalysisFailed() {
    return [];
  }
  async sendRecipeAnalysisNotRecipe() {
    return [];
  }
}

const classification = (
  recipeProbability: number,
  nonRecipeProbability: number,
): RecipeContentClassification => ({
  model: "jev-1.13.0",
  choice: recipeProbability >= nonRecipeProbability ? "recipe" : "non_recipe",
  recipeProbability,
  nonRecipeProbability,
  latencyMs: 12,
});

function routerWith(classify: RecipeContentClassifier["classify"]) {
  const classifier: RecipeContentClassifier = {
    model: "jev-1.13.0",
    classify,
  };
  return new JevRecipeRouter(classifier, thresholds);
}

async function createRecipe(
  context: PostgresTestContext,
  sourceType: SourceContent["sourceType"],
  url: string,
) {
  const user = await context.prisma.user.create({
    data: {
      firebaseUid: randomUUID(),
      setting: { create: {} },
    },
  });
  return context.prisma.recipe.create({
    data: {
      userId: user.id,
      originalUrl: url,
      normalizedUrl: url,
      sourceType,
    },
  });
}

describe("Jev production routing E2E", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("hard-rejects general Web at the threshold and logs the routing snapshot without source text", async () => {
    const url = "https://example.com/editorial";
    const rawText = "  季節の食文化について\r\n家族の思い出を紹介します。  ";
    const recipe = await createRecipe(context, "web", url);
    const classify = vi.fn(async () => classification(0.2, 0.8));
    const extractText = vi.fn(async () => completeResult());
    const log = vi.fn();

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "web",
          resolvedUrl: url,
          imageUrl: null,
          textForAi: rawText,
        }),
      },
      recipeExtractor: { extract: extractText },
      textRecipeExtractor: { extract: extractText },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, log)).resolves.toEqual({
      retry: false,
    });

    const saved = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(saved.analysisStatus).toBe("not_recipe");
    expect(extractText).not.toHaveBeenCalled();
    expect(classify).toHaveBeenCalledOnce();

    const events = log.mock.calls.map(([fields]) => fields as Record<string, unknown>);
    const decision = events.find((fields) => fields.event === "jev_routing_decision");
    const outcome = events.find((fields) => fields.event === "jev_routing_outcome");
    const normalized = normalizeJevInput(rawText);
    expect(decision).toMatchObject({
      jevSucceeded: true,
      thresholdName: "JEV_GENERAL_WEB_NON_RECIPE_THRESHOLD",
      thresholdValue: 0.8,
      thresholdMatched: true,
      selectedRoute: "not_recipe",
      inputChars: normalized.length,
      inputSha256: createHash("sha256")
        .update(normalized, "utf8")
        .digest("hex"),
    });
    expect(outcome).toMatchObject({
      selectedRoute: "not_recipe",
      finalRoute: "not_recipe",
      finalAnalysisStatus: "not_recipe",
    });
    expect(JSON.stringify(events)).not.toContain(rawText);
  });

  it("fails open to the legacy route when Jev fails and does not retry Jev in the delivery", async () => {
    const url = "https://example.com/recipe";
    const recipe = await createRecipe(context, "web", url);
    const classify = vi.fn(async () => {
      throw new RecipeContentClassifierError("timeout", 3001, "timed out");
    });
    const extractText = vi.fn(async () => completeResult());
    const log = vi.fn();

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "web",
          resolvedUrl: url,
          imageUrl: null,
          textForAi: "材料 食材 1個 作り方 調理する",
        }),
      },
      recipeExtractor: { extract: extractText },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, log)).resolves.toEqual({
      retry: false,
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(extractText).toHaveBeenCalledOnce();
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("completed");

    const events = log.mock.calls.map(([fields]) => fields as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "jev_routing_decision",
        jevSucceeded: false,
        jevFailureClass: "timeout",
        selectedRoute: "fail_open",
      }),
    );
    expect(
      events.some((fields) => fields.event === "jev_routing_outcome"),
    ).toBe(false);
  });

  it("falls back from Jev-selected Instagram text to media when text is incomplete", async () => {
    const url = "https://www.instagram.com/p/example/";
    const recipe = await createRecipe(context, "instagram", url);
    const classify = vi.fn(async () => classification(0.99, 0.01));
    const extractText = vi.fn(async () => incompleteResult());
    const extractMedia = vi.fn(async () => completeResult("gemini"));
    const log = vi.fn();

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "instagram",
          resolvedUrl: url,
          imageUrl: null,
          textForAi: "caption text",
        }),
      },
      recipeExtractor: { extract: extractText },
      textRecipeExtractor: { extract: extractText },
      instagramMediaFallback: { extract: extractMedia },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, log)).resolves.toEqual({
      retry: false,
    });
    expect(extractText).toHaveBeenCalledOnce();
    expect(extractMedia).toHaveBeenCalledOnce();
    const events = log.mock.calls.map(([fields]) => fields as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "jev_routing_outcome",
        selectedRoute: "text",
        finalRoute: "instagram_media",
        textExtractionComplete: false,
        mediaFallbackUsed: true,
        finalAnalysisStatus: "completed",
      }),
    );
  });

  it("routes low-probability TikTok photos directly to photo media", async () => {
    const url = "https://www.tiktok.com/@chef/photo/12345";
    const recipe = await createRecipe(context, "tiktok", url);
    const classify = vi.fn(async () => classification(0.5, 0.5));
    const extractText = vi.fn(async () => completeResult());
    const extractPhoto = vi.fn(async () => completeResult("gemini"));

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "tiktok",
          resolvedUrl: url,
          imageUrl: "https://images.example/photo.jpg",
          textForAi: "caption text",
          tiktokMediaKind: "photo",
          tiktokPhotoImageUrls: ["https://images.example/photo.jpg"],
        }),
      },
      recipeExtractor: { extract: extractText },
      textRecipeExtractor: { extract: extractText },
      tiktokPhotoAnalysis: { extract: extractPhoto },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(extractText).not.toHaveBeenCalled();
    expect(extractPhoto).toHaveBeenCalledOnce();
  });

  it("does not return to incomplete YouTube text when the selected Gemini route fails", async () => {
    const url = "https://www.youtube.com/watch?v=example";
    const description =
      "材料\n食材 1個\n調味料 小さじ1\n作り方\n1. 混ぜる\n2. 焼く";
    const recipe = await createRecipe(context, "youtube", url);
    const classify = vi.fn(async () => classification(0.99, 0.01));
    const extractText = vi.fn(async () => incompleteResult());
    const extractGemini = vi.fn(async () => {
      throw new AnalysisError(
        "YOUTUBE_VIDEO_ANALYSIS_FAILED",
        false,
        "Gemini failed",
        "gemini",
      );
    });

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "youtube",
          resolvedUrl: url,
          imageUrl: null,
          textForAi: `TITLE\nテスト料理\n\nDESCRIPTION\n${description}`,
          youtubeDescription: description,
        }),
      },
      recipeExtractor: { extract: extractText },
      textRecipeExtractor: { extract: extractText },
      youtubeVideoFallback: { extract: extractGemini },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(extractText).toHaveBeenCalledOnce();
    expect(extractGemini).toHaveBeenCalledOnce();
    const saved = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(saved.analysisStatus).toBe("failed");
    expect(saved.ingredients).toHaveLength(0);
    expect(saved.steps).toHaveLength(0);
  });

  it("allows one new Jev request on a later delivery caused by a downstream retryable error", async () => {
    const url = "https://example.com/retryable";
    const recipe = await createRecipe(context, "web", url);
    const classify = vi.fn(async () => classification(0.9, 0.1));
    let extractionAttempt = 0;
    const extractText = vi.fn(async () => {
      extractionAttempt += 1;
      if (extractionAttempt === 1)
        throw new AnalysisError("AI_PROVIDER_ERROR", true, "temporary", "zai");
      return completeResult();
    });

    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "web",
          resolvedUrl: url,
          imageUrl: null,
          textForAi: "材料 食材 1個 作り方 調理する",
        }),
      },
      recipeExtractor: { extract: extractText },
      textRecipeExtractor: { extract: extractText },
      jevRouter: routerWith(classify),
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, vi.fn())).resolves.toEqual({
      retry: true,
    });
    await expect(service.process(recipe.id, 2, vi.fn())).resolves.toEqual({
      retry: false,
    });
    expect(classify).toHaveBeenCalledTimes(2);
    expect(extractText).toHaveBeenCalledTimes(2);
  });
});
