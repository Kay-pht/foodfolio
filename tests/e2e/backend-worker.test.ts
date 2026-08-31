import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildWorker } from "../../src/api/build-worker.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import {
  AnalysisError,
  type NotificationSender,
  type RecipeExtractor,
  type SourceContentExtractor,
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
    providerRequestId: "provider-1",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 12,
  }),
};

class FakeNotifications implements NotificationSender {
  completed: string[] = [];
  failed: string[] = [];
  async sendRecipeAnalysisCompleted(_tokens: string[], recipeId: string) {
    this.completed.push(recipeId);
    return [];
  }
  async sendRecipeAnalysisFailed(_tokens: string[], recipeId: string) {
    this.failed.push(recipeId);
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
    expect(updated.ingredients[0]?.name).toBe("鶏肉");
    expect(notifications.completed).toEqual([recipe.id]);
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
        throw new AnalysisError("AI_TIMEOUT", true, "timeout");
      },
    };
    const worker = buildWorker(
      new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor,
        recipeExtractor: failingAi,
        notifications,
        maxAttempts: 3,
      }),
    );
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
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        })
      ).analysisStatus,
    ).toBe("failed");
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
