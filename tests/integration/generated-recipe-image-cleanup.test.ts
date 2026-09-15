import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import type {
  GeneratedRecipeImageStore,
  NotificationSender,
  RecipeExtractor,
  RecipeThumbnailGenerator,
  SourceContentExtractor,
} from "../../src/application/analysis/types.js";
import type {
  AuthVerifier,
  FirebaseUserManager,
} from "../../src/infrastructure/auth/auth-verifier.js";
import type { AnalysisTaskQueue } from "../../src/infrastructure/tasks/task-queue.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const auth: AuthVerifier = {
  verifyIdToken: async (token) => ({ firebaseUid: token }),
};
const firebaseUsers: FirebaseUserManager = { deleteUser: async () => {} };
const taskQueue: AnalysisTaskQueue = { enqueueRecipeAnalysis: async () => {} };
const headers = (user: string) => ({ authorization: `Bearer ${user}` });
const generatedImage = {
  data: new Uint8Array([1, 2, 3]),
  contentType: "image/webp",
  extension: "webp",
};
const aiSharedSource: SourceContentExtractor = {
  extract: async () => ({
    sourceType: "chatgpt",
    resolvedUrl: "https://chatgpt.com/share/delete-race",
    imageUrl: null,
    textForAi: "recipe transcript",
  }),
};
const completeRecipeExtractor: RecipeExtractor = {
  extract: async () => ({
    recipe: {
      title: "削除競合レシピ",
      servings: null,
      cookingTimeMinutes: null,
      genre: null,
      ingredients: [{ name: "材料", amount: "1個" }],
      steps: ["調理する"],
    },
    provider: "zai",
    providerRequestId: "delete-race",
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
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

function generatedImageStore(options?: {
  publish?: GeneratedRecipeImageStore["publish"];
  deleteForRecipe?: (recipeId: string) => Promise<void>;
}): GeneratedRecipeImageStore {
  return {
    publish:
      options?.publish ??
      (async () => ({
        url: "https://storage.googleapis.com/generated/unused.webp",
        delete: async () => {},
      })),
    owns: (imageUrl) => imageUrl?.includes("/recipe-images/") ?? false,
    deleteForRecipe: options?.deleteForRecipe ?? (async () => {}),
  };
}

describe("generated recipe image cleanup", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("deletes a managed generated image before deleting its recipe", async () => {
    const deleteForRecipe = vi.fn(async () => {});
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: generatedImageStore({ deleteForRecipe }),
    });
    const userHeaders = headers("generated-image-delete-user");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/generated-image-delete" },
    });
    const recipeId = created.json().id as string;
    await context.prisma.recipe.update({
      where: { id: recipeId },
      data: {
        analysisStatus: "completed",
        imageUrl: `https://storage.googleapis.com/bucket/recipe-images/${recipeId}/image.webp`,
      },
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/recipes/${recipeId}`,
      headers: userHeaders,
    });

    expect(deleted.statusCode).toBe(204);
    expect(deleteForRecipe).toHaveBeenCalledWith(recipeId);
    expect(await context.prisma.recipe.count({ where: { id: recipeId } })).toBe(
      0,
    );
    await app.close();
  });

  it("keeps the recipe when generated-image cleanup fails", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: generatedImageStore({
        deleteForRecipe: async () => {
          throw new Error("storage unavailable");
        },
      }),
    });
    const userHeaders = headers("generated-image-delete-retry-user");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/generated-image-delete-retry" },
    });
    const recipeId = created.json().id as string;
    await context.prisma.recipe.update({
      where: { id: recipeId },
      data: {
        analysisStatus: "completed",
        imageUrl: `https://storage.googleapis.com/bucket/recipe-images/${recipeId}/image.webp`,
      },
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/recipes/${recipeId}`,
      headers: userHeaders,
    });

    expect(deleted.statusCode).toBe(503);
    expect(await context.prisma.recipe.count({ where: { id: recipeId } })).toBe(
      1,
    );
    await app.close();
  });

  it("deletes generated image prefixes before account-owned rows", async () => {
    const deleteForRecipe = vi.fn(async () => {});
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: generatedImageStore({ deleteForRecipe }),
    });
    const userHeaders = headers("generated-image-account-delete-user");
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: userHeaders,
    });
    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "generated-image-account-delete-user" },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://chatgpt.com/share/delete-account-image",
        normalizedUrl: "https://chatgpt.com/share/delete-account-image",
        sourceType: "chatgpt",
        imageUrl:
          "https://storage.googleapis.com/bucket/recipe-images/account-recipe/image.webp",
      },
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/me",
      headers: userHeaders,
    });

    expect(deleted.statusCode).toBe(204);
    expect(deleteForRecipe).toHaveBeenCalledWith(recipe.id);
    expect(await context.prisma.user.count({ where: { id: user.id } })).toBe(0);
    await app.close();
  });

  it("serializes recipe deletion against worker completion and leaves no published orphan", async () => {
    let markGenerationStarted: (() => void) | undefined;
    let releaseGeneration: (() => void) | undefined;
    let markCleanupStarted: (() => void) | undefined;
    let releaseCleanup: (() => void) | undefined;
    let markPublished: (() => void) | undefined;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationReleased = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const published = new Promise<void>((resolve) => {
      markPublished = resolve;
    });
    const deletePublishedObject = vi.fn(async () => {});
    const store = generatedImageStore({
      publish: async (recipeId) => {
        markPublished?.();
        return {
          url: `https://storage.googleapis.com/generated/recipe-images/${recipeId}/late.webp`,
          delete: deletePublishedObject,
        };
      },
      deleteForRecipe: async () => {
        markCleanupStarted?.();
        await cleanupReleased;
      },
    });
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: store,
    });
    const userHeaders = headers("generated-image-delete-race-user");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://chatgpt.com/share/delete-race-recipe" },
    });
    const recipeId = created.json().id as string;
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
      } satisfies RecipeThumbnailGenerator,
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    const worker = service.process(recipeId, 1, vi.fn());
    await generationStarted;
    const deleting = app.inject({
      method: "DELETE",
      url: `/v1/recipes/${recipeId}`,
      headers: userHeaders,
    });
    await cleanupStarted;

    releaseGeneration?.();
    await published;
    releaseCleanup?.();

    const deleted = await deleting;
    expect(deleted.statusCode).toBe(204);
    await expect(worker).resolves.toEqual({ retry: false });
    expect(deletePublishedObject).toHaveBeenCalledOnce();
    expect(
      await context.prisma.recipe.findUnique({ where: { id: recipeId } }),
    ).toBeNull();
    await app.close();
  });

  it("serializes account deletion against worker completion and leaves no published orphan", async () => {
    let markGenerationStarted: (() => void) | undefined;
    let releaseGeneration: (() => void) | undefined;
    let markCleanupStarted: (() => void) | undefined;
    let releaseCleanup: (() => void) | undefined;
    let markPublished: (() => void) | undefined;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationReleased = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const published = new Promise<void>((resolve) => {
      markPublished = resolve;
    });
    const deletePublishedObject = vi.fn(async () => {});
    const store = generatedImageStore({
      publish: async (recipeId) => {
        markPublished?.();
        return {
          url: `https://storage.googleapis.com/generated/recipe-images/${recipeId}/late-account.webp`,
          delete: deletePublishedObject,
        };
      },
      deleteForRecipe: async () => {
        markCleanupStarted?.();
        await cleanupReleased;
      },
    });
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: store,
    });
    const userHeaders = headers("generated-image-account-delete-race-user");
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: userHeaders,
    });
    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "generated-image-account-delete-race-user" },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://chatgpt.com/share/delete-race-account",
        normalizedUrl: "https://chatgpt.com/share/delete-race-account",
        sourceType: "chatgpt",
      },
    });
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
      } satisfies RecipeThumbnailGenerator,
      generatedImageStore: store,
      notifications: new NoopNotifications(),
      maxAttempts: 3,
    });

    const worker = service.process(recipe.id, 1, vi.fn());
    await generationStarted;
    const deleting = app.inject({
      method: "DELETE",
      url: "/v1/me",
      headers: userHeaders,
    });
    await cleanupStarted;

    releaseGeneration?.();
    await published;
    releaseCleanup?.();

    const deleted = await deleting;
    expect(deleted.statusCode).toBe(204);
    await expect(worker).resolves.toEqual({ retry: false });
    expect(deletePublishedObject).toHaveBeenCalledOnce();
    expect(await context.prisma.user.count({ where: { id: user.id } })).toBe(0);
    await app.close();
  });
});
