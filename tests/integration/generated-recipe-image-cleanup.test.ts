import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import type { GeneratedRecipeImageStore } from "../../src/application/analysis/types.js";
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

function generatedImageStore(options?: {
  deleteForRecipe?: (recipeId: string) => Promise<void>;
}): GeneratedRecipeImageStore {
  return {
    publish: async () => "https://storage.googleapis.com/generated/unused.webp",
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
    expect(
      await context.prisma.recipe.count({ where: { id: recipeId } }),
    ).toBe(0);
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
    expect(
      await context.prisma.recipe.count({ where: { id: recipeId } }),
    ).toBe(1);
    await app.close();
  });

  it("deletes managed generated images before account-owned rows", async () => {
    const deleteForRecipe = vi.fn(async () => {});
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      generatedImageStore: generatedImageStore({ deleteForRecipe }),
    });
    const userHeaders = headers("generated-image-account-delete-user");
    await app.inject({ method: "GET", url: "/v1/settings", headers: userHeaders });
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
});
