import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildWorker } from "../../src/api/build-worker.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import {
  AnalysisError,
  type NotificationSender,
  type RecipeExtractor,
  type SourceContentExtractor,
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
});
