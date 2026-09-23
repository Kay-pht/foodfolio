import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWorker } from "../../src/api/build-worker.js";
import {
  completeNotRecipeAnalysis,
  RecipeAnalysisService,
} from "../../src/application/analysis/analysis-service.js";
import { finishAnalysisAdmission } from "../../src/application/analysis/admission-service.js";
import {
  AnalysisError,
  NOT_RECIPE_MESSAGE,
  type NotificationSender,
  type RecipeExtractor,
  type SourceContentExtractor,
  type TikTokPhotoRecipeAnalysis,
  type TikTokVideoRecipeFallback,
} from "../../src/application/analysis/types.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const sourceExtractor: SourceContentExtractor = {
  extract: async (url) => ({
    sourceType: "web",
    resolvedUrl: url.toString(),
    imageUrl: "https://images.example/recipe.jpg",
    textForAi: "TITLE 親子丼 材料 鶏肉 200g 作り方 煮る",
  }),
};
const recipeExtractor: RecipeExtractor = {
  extract: async () => ({
    recipe: {
      title: "親子丼",
      servings: { value: 2, raw: "2人分" },
      cookingTimeMinutes: 20,
      genre: "主菜",
      ingredients: [{ name: "鶏肉", amount: "200g" }],
      steps: ["煮る"],
    },
    provider: "zai",
    providerRequestId: "provider-1",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 12,
  }),
};

class FakeNotifications implements NotificationSender {
  completed: string[] = [];
  failed: string[] = [];
  notRecipe: string[] = [];
  async sendRecipeAnalysisCompleted(_tokens: string[], recipeId: string) {
    this.completed.push(recipeId);
    return [];
  }
  async sendRecipeAnalysisFailed(_tokens: string[], recipeId: string) {
    this.failed.push(recipeId);
    return [];
  }
  async sendRecipeAnalysisNotRecipe(_tokens: string[], recipeId: string) {
    this.notRecipe.push(recipeId);
    return [];
  }
}

const waitForClockTick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("API/Worker application E2E", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("runs a task through extraction, AI mapping, database update and success notification", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "worker-user",
        setting: { create: {} },
        deviceTokens: { create: { fcmToken: "token" } },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/recipe",
        normalizedUrl: "https://example.com/recipe",
        sourceType: "web",
      },
    });
    const notifications = new FakeNotifications();
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor,
        recipeExtractor,
        notifications,
        maxAttempts: 3,
      }),
    );
    expect(
      (await worker.inject({ method: "GET", url: "/health" })).json(),
    ).toEqual({
      status: "ok",
    });
    await waitForClockTick();
    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      headers: { "x-cloudtasks-taskretrycount": "0" },
      payload: { recipeId: recipe.id },
    });
    expect(response.statusCode).toBe(204);
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      recipe.updatedAt.getTime(),
    );
    expect(updated.title).toBe("親子丼");
    expect(updated.analysisProvider).toBe("zai");
    expect(updated.ingredients[0]?.name).toBe("鶏肉");
    expect(notifications.completed).toEqual([recipe.id]);
    await worker.close();
  });

  it("persists and logs Gemini when the YouTube video fallback produced the result", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "youtube-gemini-provider-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
        normalizedUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
        sourceType: "youtube",
      },
    });
    const log = vi.fn();
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: {
        extract: async () => ({
          sourceType: "youtube",
          resolvedUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
          imageUrl: null,
          textForAi: "TITLE\n親子丼",
          youtubeDescription: "",
        }),
      },
      recipeExtractor: {
        extract: async () => {
          const result = await recipeExtractor.extract(
            await sourceExtractor.extract(new URL("https://example.com")),
          );
          return {
            ...result,
            provider: "gemini" as const,
            providerRequestId: "gemini-request",
          };
        },
      },
      notifications: new FakeNotifications(),
      maxAttempts: 3,
    });

    await expect(service.process(recipe.id, 1, log)).resolves.toEqual({
      retry: false,
    });
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(updated.analysisProvider).toBe("gemini");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gemini",
        videoFallbackUsed: true,
      }),
      "recipe analysis completed",
    );
  });

  it("persists not_recipe as terminal, notifies, and finishes admission without re-extraction", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "not-recipe-worker-user",
        setting: { create: { recipeAnalysisNotificationEnabled: true } },
        deviceTokens: { create: { fcmToken: "not-recipe-token" } },
      },
    });
    const runId = "00000000-0000-0000-0000-000000000116";
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/not-a-recipe",
        normalizedUrl: "https://example.com/not-a-recipe",
        sourceType: "web",
        analysisStatus: "processing",
        processingRunId: runId,
        processingLeaseExpiresAt: new Date(Date.now() + 60_000),
        title: "stale extracted title",
        imageUrl: "https://images.example/stale.jpg",
        analysisProvider: "zai",
        ingredients: {
          create: [{ name: "stale ingredient", amount: null, sortOrder: 0 }],
        },
        steps: { create: [{ text: "stale step", sortOrder: 0 }] },
      },
    });
    await context.prisma.analysisAdmission.create({
      data: { userId: user.id, recipeId: recipe.id },
    });
    const notifications = new FakeNotifications();
    const log = vi.fn();

    await expect(
      completeNotRecipeAnalysis(
        { prisma: context.prisma, notifications },
        recipe.id,
        runId,
        1,
        log,
      ),
    ).resolves.toBe(true);

    const transitioned = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(transitioned).toMatchObject({
      analysisStatus: "not_recipe",
      title: NOT_RECIPE_MESSAGE,
      imageUrl: null,
      analysisProvider: null,
      processingRunId: null,
      processingLeaseExpiresAt: null,
    });
    expect(transitioned.ingredients).toEqual([]);
    expect(transitioned.steps).toEqual([]);
    expect(notifications.notRecipe).toEqual([recipe.id]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: recipe.id,
        analysisStatus: "not_recipe",
        analysisAttempt: 1,
      }),
      "recipe classified as not recipe",
    );

    const extractSource = vi.fn(sourceExtractor.extract);
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: { extract: extractSource },
        recipeExtractor,
        notifications,
        maxAttempts: 3,
      }),
      async (recipeId) => finishAnalysisAdmission(context.prisma, recipeId),
    );
    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });
    expect(response.statusCode).toBe(204);
    expect(extractSource).not.toHaveBeenCalled();
    const admission = await context.prisma.analysisAdmission.findUniqueOrThrow({
      where: { recipeId: recipe.id },
    });
    expect(admission.finishedAt).toBeInstanceOf(Date);
    await worker.close();
  });

  it("retries transient failure, marks final failure, and respects notification OFF", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "failed-user",
        setting: { create: { recipeAnalysisNotificationEnabled: false } },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/fail",
        normalizedUrl: "https://example.com/fail",
        sourceType: "web",
      },
    });
    const notifications = new FakeNotifications();
    const failingAi: RecipeExtractor = {
      extract: async () => {
        throw new AnalysisError("AI_TIMEOUT", true, "timeout", "zai");
      },
    };
    const logs: Array<Record<string, unknown>> = [];
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor,
      recipeExtractor: failingAi,
      notifications,
      maxAttempts: 3,
    });
    const worker = buildWorker({
      process: (recipeId, attempt, log) =>
        service.process(recipeId, attempt, (fields, message) => {
          logs.push({ ...fields, message });
          log(fields, message);
        }),
    });
    const first = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      headers: { "x-cloudtasks-taskretrycount": "0" },
      payload: { recipeId: recipe.id },
    });
    expect(first.statusCode).toBe(503);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("pending");
    const final = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      headers: { "x-cloudtasks-taskretrycount": "2" },
      payload: { recipeId: recipe.id },
    });
    expect(final.statusCode).toBe(204);
    const failedRecipe = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(failedRecipe.analysisStatus).toBe("failed");
    expect(failedRecipe.analysisProvider).toBe("zai");
    expect(
      logs.find(({ analysisStatus }) => analysisStatus === "failed"),
    ).toMatchObject({
      analysisAttempt: 3,
      analysisAttemptLabel: "3",
      errorCode: "AI_TIMEOUT",
      provider: "zai",
      severity: "ERROR",
      target: "レシピ解析",
      summary: "AIによるレシピ解析が最終試行まで成功しませんでした。",
      retryPolicy: "final_failure",
      message: "recipe analysis failed",
    });
    expect(notifications.failed).toEqual([]);
    await worker.close();
  });

  it("reclaims a processing recipe on Cloud Tasks retry after an interrupted worker", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "interrupted-worker-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/interrupted",
        normalizedUrl: "https://example.com/interrupted",
        sourceType: "web",
        analysisStatus: "processing",
      },
    });
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor,
        recipeExtractor,
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const duplicateInitialDelivery = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      headers: { "x-cloudtasks-taskretrycount": "0" },
      payload: { recipeId: recipe.id },
    });
    expect(duplicateInitialDelivery.statusCode).toBe(503);

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      headers: { "x-cloudtasks-taskretrycount": "1" },
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("completed");
    await worker.close();
  });

  it("applies the same notification toggle to successful and failed analysis", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "notification-matrix-user",
        setting: { create: { recipeAnalysisNotificationEnabled: false } },
        deviceTokens: { create: { fcmToken: "notification-matrix-token" } },
      },
    });
    const successRecipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/notification-off-success",
        normalizedUrl: "https://example.com/notification-off-success",
        sourceType: "web",
      },
    });
    const notifications = new FakeNotifications();
    const successWorker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor,
        recipeExtractor,
        notifications,
        maxAttempts: 3,
      }),
    );
    expect(
      (
        await successWorker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: successRecipe.id },
        })
      ).statusCode,
    ).toBe(204);
    expect(notifications.completed).toEqual([]);
    await successWorker.close();

    await context.prisma.userSetting.update({
      where: { userId: user.id },
      data: { recipeAnalysisNotificationEnabled: true },
    });
    const failedRecipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/notification-on-failure",
        normalizedUrl: "https://example.com/notification-on-failure",
        sourceType: "web",
      },
    });
    const failedWorker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => {
            throw new AnalysisError("SOURCE_NOT_FOUND", false, "not found");
          },
        },
        recipeExtractor,
        notifications,
        maxAttempts: 3,
      }),
    );
    expect(
      (
        await failedWorker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: failedRecipe.id },
        })
      ).statusCode,
    ).toBe(204);
    expect(notifications.failed).toEqual([failedRecipe.id]);
    await failedWorker.close();
  });

  it("uses TikTok video fallback when title extraction has no ingredients or steps", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-video-fallback-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/video/123",
        normalizedUrl: "https://www.tiktok.com/@chef/video/123",
        sourceType: "tiktok",
      },
    });
    const tiktokSourceExtractor: SourceContentExtractor = {
      extract: async () => ({
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/video/123",
        imageUrl: "https://images.example/tiktok.jpg",
        textForAi: "TITLE\n絶品パスタ",
      }),
    };
    const titleExtractor: RecipeExtractor = {
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
        providerRequestId: "title-request",
        inputTokens: 3,
        outputTokens: 4,
        latencyMs: 5,
      }),
    };
    const extractVideo = vi.fn(async () => ({
      recipe: {
        title: "絶品パスタ",
        servings: { value: 1, raw: "1人分" },
        cookingTimeMinutes: 15,
        genre: "麺",
        ingredients: [{ name: "パスタ", amount: "100g" }],
        steps: ["パスタを茹でる"],
      },
      provider: "zai",
      providerRequestId: "video-request",
      inputTokens: 30,
      outputTokens: 40,
      latencyMs: 50,
    }));
    const tiktokVideoFallback: TikTokVideoRecipeFallback = {
      extract: extractVideo,
    };
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: tiktokSourceExtractor,
        recipeExtractor: titleExtractor,
        tiktokVideoFallback,
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(extractVideo).toHaveBeenCalledOnce();
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.steps).toHaveLength(1);
    await worker.close();
  });

  it("routes a TikTok photo post directly to one caption-and-image analysis", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-photo-analysis-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/photo/12345?_r=1",
        normalizedUrl: "https://www.tiktok.com/@chef/photo/12345",
        sourceType: "tiktok",
      },
    });
    const extractText = vi.fn();
    const extractPhoto = vi.fn<TikTokPhotoRecipeAnalysis["extract"]>(
      async () => ({
        recipe: {
          title: "肉巻きポテト",
          servings: null,
          cookingTimeMinutes: 20,
          genre: "主菜",
          ingredients: [{ name: "じゃがいも", amount: "2個" }],
          steps: ["豚肉で巻いて焼く"],
        },
        provider: "zai",
        providerRequestId: "photo-request",
        inputTokens: 30,
        outputTokens: 40,
        latencyMs: 50,
      }),
    );
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "tiktok",
            resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
            imageUrl: "https://images.example/first.jpg",
            textForAi: "DESCRIPTION\n肉巻きポテト #レシピ",
            tiktokMediaKind: "photo",
            tiktokPhotoImageUrls: ["https://images.example/first.jpg"],
          }),
        },
        recipeExtractor: { extract: extractText },
        tiktokPhotoAnalysis: { extract: extractPhoto },
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(extractText).not.toHaveBeenCalled();
    expect(extractPhoto).toHaveBeenCalledOnce();
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.imageUrl).toBe("https://images.example/first.jpg");
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.steps).toHaveLength(1);
    await worker.close();
  });

  it("does not download a TikTok video when title extraction is complete", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-title-complete-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/video/789",
        normalizedUrl: "https://www.tiktok.com/@chef/video/789",
        sourceType: "tiktok",
      },
    });
    const extractVideo = vi.fn();
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "tiktok",
            resolvedUrl: "https://www.tiktok.com/@chef/video/789",
            imageUrl: null,
            textForAi: "TITLE\n材料 パスタ100g 作り方 茹でる",
          }),
        },
        recipeExtractor: {
          extract: async () => ({
            recipe: {
              title: "パスタ",
              servings: null,
              cookingTimeMinutes: null,
              genre: "麺",
              ingredients: [{ name: "パスタ", amount: "100g" }],
              steps: ["茹でる"],
            },
            provider: "zai",
            providerRequestId: "title-request",
            inputTokens: 3,
            outputTokens: 4,
            latencyMs: 5,
          }),
        },
        tiktokVideoFallback: { extract: extractVideo },
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(extractVideo).not.toHaveBeenCalled();
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("completed");
    await worker.close();
  });

  it("keeps the fallback title when the provider omits only the title", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-provider-title-missing-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/video/890",
        normalizedUrl: "https://www.tiktok.com/@chef/video/890",
        sourceType: "tiktok",
      },
    });
    const extractVideo = vi.fn();
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "tiktok",
            resolvedUrl: "https://www.tiktok.com/@chef/video/890",
            imageUrl: null,
            textForAi: "TITLE\n材料 パスタ100g 作り方 茹でる",
          }),
        },
        recipeExtractor: {
          extract: async () => ({
            recipe: {
              title: null,
              servings: null,
              cookingTimeMinutes: null,
              genre: "麺",
              ingredients: [{ name: "パスタ", amount: "100g" }],
              steps: ["茹でる"],
            },
            provider: "zai",
            providerRequestId: "missing-title-request",
            inputTokens: 3,
            outputTokens: 4,
            latencyMs: 5,
          }),
        },
        tiktokVideoFallback: { extract: extractVideo },
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(extractVideo).not.toHaveBeenCalled();
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
    });
    expect(updated.analysisStatus).toBe("completed");
    expect(updated.title).toBe("タイトル未取得のレシピ");
    await worker.close();
  });

  it("fails without creating an incomplete page when video extraction is still incomplete", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-video-incomplete-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/video/999",
        normalizedUrl: "https://www.tiktok.com/@chef/video/999",
        sourceType: "tiktok",
      },
    });
    const extractTitle = vi.fn(async () => {
      throw new Error("title extraction must not run without title text");
    });
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "tiktok",
            resolvedUrl: "https://www.tiktok.com/@chef/video/999",
            imageUrl: null,
            textForAi: null,
          }),
        },
        recipeExtractor: { extract: extractTitle },
        tiktokVideoFallback: {
          extract: async () => ({
            recipe: {
              title: null,
              servings: null,
              cookingTimeMinutes: null,
              genre: null,
              ingredients: [],
              steps: [],
            },
            provider: "zai",
            providerRequestId: "video-request",
            inputTokens: 3,
            outputTokens: 4,
            latencyMs: 5,
          }),
        },
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(extractTitle).not.toHaveBeenCalled();
    const updated = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipe.id },
      include: { ingredients: true, steps: true },
    });
    expect(updated.analysisStatus).toBe("failed");
    expect(updated.ingredients).toHaveLength(0);
    expect(updated.steps).toHaveLength(0);
    await worker.close();
  });

  it("fails an incomplete TikTok title without downloading when fallback is disabled", async () => {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: "tiktok-video-fallback-disabled-user",
        setting: { create: {} },
      },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://www.tiktok.com/@chef/video/456",
        normalizedUrl: "https://www.tiktok.com/@chef/video/456",
        sourceType: "tiktok",
      },
    });
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "tiktok",
            resolvedUrl: "https://www.tiktok.com/@chef/video/456",
            imageUrl: null,
            textForAi: "TITLE\n絶品パスタ",
          }),
        },
        recipeExtractor: {
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
            providerRequestId: "title-request",
            inputTokens: 3,
            outputTokens: 4,
            latencyMs: 5,
          }),
        },
        notifications: new FakeNotifications(),
        maxAttempts: 3,
      }),
    );

    const response = await worker.inject({
      method: "POST",
      url: "/internal/tasks/recipe-analysis",
      payload: { recipeId: recipe.id },
    });

    expect(response.statusCode).toBe(204);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("failed");
    await worker.close();
  });
});
