import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const log = () => {};
const source = {
  sourceType: "web" as const,
  resolvedUrl: "https://example.com/recipe",
  imageUrl: null,
  textForAi: "recipe",
};
const successResult = (title: string) => ({
  recipe: {
    title,
    servings: null,
    cookingTimeMinutes: null,
    genre: null,
    ingredients: [{ name: title, amount: "1個" }],
    steps: [title],
  },
  provider: "zai",
  providerRequestId: title,
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 1,
});

class Notifications implements NotificationSender {
  invalid: string[] = [];
  shouldThrow = false;
  async sendRecipeAnalysisCompleted() {
    if (this.shouldThrow) throw new Error("notification failed");
    return this.invalid;
  }
  async sendRecipeAnalysisFailed() {
    if (this.shouldThrow) throw new Error("notification failed");
    return this.invalid;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Worker lease and delivery ownership E2E", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  async function recipe(name: string, notification = false) {
    const user = await context.prisma.user.create({
      data: {
        firebaseUid: `worker-lease-${name}`,
        setting: {
          create: { recipeAnalysisNotificationEnabled: notification },
        },
        ...(notification
          ? { deviceTokens: { create: { fcmToken: `token-${name}` } } }
          : {}),
      },
    });
    return context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: `https://example.com/${name}`,
        normalizedUrl: `https://example.com/${name}`,
        sourceType: "web",
      },
    });
  }

  it("allows only one worker to claim the same pending recipe", async () => {
    const target = await recipe("single-claim");
    const entered = deferred<void>();
    const release = deferred<void>();
    let extractionCalls = 0;
    const sourceExtractor: SourceContentExtractor = {
      extract: async () => {
        extractionCalls += 1;
        entered.resolve();
        await release.promise;
        return source;
      },
    };
    const extractor: RecipeExtractor = {
      extract: async () => successResult("winner"),
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor,
      recipeExtractor: extractor,
      notifications: new Notifications(),
      maxAttempts: 3,
    });

    const first = service.process(target.id, 1, log);
    await entered.promise;
    const duplicate = await service.process(target.id, 1, log);
    expect(duplicate.retry).toBe(true);
    expect(extractionCalls).toBe(1);
    release.resolve();
    expect((await first).retry).toBe(false);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: target.id },
        })
      ).analysisStatus,
    ).toBe("completed");
  });

  it("does not reclaim an active lease but reclaims an expired lease", async () => {
    const active = await recipe("active-lease");
    await context.prisma.recipe.update({
      where: { id: active.id },
      data: {
        analysisStatus: "processing",
        processingRunId: "00000000-0000-0000-0000-000000000001",
        processingLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    let calls = 0;
    const sourceExtractor: SourceContentExtractor = {
      extract: async () => {
        calls += 1;
        return source;
      },
    };
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor,
      recipeExtractor: { extract: async () => successResult("active") },
      notifications: new Notifications(),
      maxAttempts: 3,
    });
    expect((await service.process(active.id, 2, log)).retry).toBe(true);
    expect(calls).toBe(0);

    await context.prisma.recipe.update({
      where: { id: active.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await service.process(active.id, 2, log)).retry).toBe(false);
    expect(calls).toBe(1);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: active.id },
        })
      ).analysisStatus,
    ).toBe("completed");
  });

  it("prevents an old worker from overwriting a reclaimed run", async () => {
    const target = await recipe("stale-result");
    const oldEntered = deferred<void>();
    const oldRelease = deferred<void>();
    const oldService = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: {
        extract: async () => {
          oldEntered.resolve();
          await oldRelease.promise;
          return successResult("old-worker");
        },
      },
      notifications: new Notifications(),
      maxAttempts: 3,
    });
    const oldRun = oldService.process(target.id, 1, log);
    await oldEntered.promise;
    await context.prisma.recipe.update({
      where: { id: target.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const newService = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: { extract: async () => successResult("new-worker") },
      notifications: new Notifications(),
      maxAttempts: 3,
    });
    expect((await newService.process(target.id, 2, log)).retry).toBe(false);
    oldRelease.resolve();
    expect((await oldRun).retry).toBe(false);
    const saved = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: target.id },
      include: { ingredients: true, steps: true },
    });
    expect(saved.title).toBe("new-worker");
    expect(saved.ingredients.map((item) => item.name)).toEqual(["new-worker"]);
    expect(saved.steps.map((item) => item.text)).toEqual(["new-worker"]);
  });

  it("prevents an old failing worker from returning a reclaimed run to pending", async () => {
    const target = await recipe("stale-failure");
    const oldEntered = deferred<void>();
    const oldRelease = deferred<void>();
    const oldService = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: {
        extract: async () => {
          oldEntered.resolve();
          await oldRelease.promise;
          throw new AnalysisError("AI_TIMEOUT", true, "timeout");
        },
      },
      notifications: new Notifications(),
      maxAttempts: 3,
    });
    const oldRun = oldService.process(target.id, 1, log);
    await oldEntered.promise;
    await context.prisma.recipe.update({
      where: { id: target.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const newEntered = deferred<void>();
    const newRelease = deferred<void>();
    const newService = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: {
        extract: async () => {
          newEntered.resolve();
          await newRelease.promise;
          return successResult("new-owner");
        },
      },
      notifications: new Notifications(),
      maxAttempts: 3,
    });
    const newRun = newService.process(target.id, 2, log);
    await newEntered.promise;
    oldRelease.resolve();
    expect((await oldRun).retry).toBe(true);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: target.id },
        })
      ).analysisStatus,
    ).toBe("processing");
    newRelease.resolve();
    expect((await newRun).retry).toBe(false);
  });

  it("removes invalid notification tokens and keeps completed state when notification sending throws", async () => {
    const invalidTarget = await recipe("invalid-token", true);
    const invalidNotifications = new Notifications();
    invalidNotifications.invalid = ["token-invalid-token"];
    const service = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: { extract: async () => successResult("notified") },
      notifications: invalidNotifications,
      maxAttempts: 3,
    });
    expect((await service.process(invalidTarget.id, 1, log)).retry).toBe(false);
    expect(
      await context.prisma.deviceToken.count({
        where: { fcmToken: "token-invalid-token" },
      }),
    ).toBe(0);

    const throwingTarget = await recipe("notification-throws", true);
    const throwingNotifications = new Notifications();
    throwingNotifications.shouldThrow = true;
    const throwingService = new RecipeAnalysisService({
      prisma: context.prisma,
      sourceExtractor: { extract: async () => source },
      recipeExtractor: {
        extract: async () => successResult("still-completed"),
      },
      notifications: throwingNotifications,
      maxAttempts: 3,
    });
    expect(
      (await throwingService.process(throwingTarget.id, 1, log)).retry,
    ).toBe(false);
    expect(
      (
        await context.prisma.recipe.findUniqueOrThrow({
          where: { id: throwingTarget.id },
        })
      ).analysisStatus,
    ).toBe("completed");
  });
});
