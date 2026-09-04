import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AuthVerifier,
  FirebaseUserManager,
} from "../../src/infrastructure/auth/auth-verifier.js";
import type { AnalysisTaskQueue } from "../../src/infrastructure/tasks/task-queue.js";
import { currentAIConsentVersion } from "../../src/api/ai-consent-routes.js";
import { buildApi } from "../../src/api/build-api.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const auth: AuthVerifier = {
  verifyIdToken: async (token) => ({ firebaseUid: token }),
};
const deletedUsers: string[] = [];
const firebaseUsers: FirebaseUserManager = {
  deleteUser: async (uid) => {
    deletedUsers.push(uid);
  },
};
const enqueued: string[] = [];
const taskQueue: AnalysisTaskQueue = {
  enqueueRecipeAnalysis: async (id) => {
    enqueued.push(id);
  },
};
const waitForClockTick = () => new Promise((resolve) => setTimeout(resolve, 5));

const grantAIConsent = async (
  app: ReturnType<typeof buildApi>,
  headers: { authorization: string },
) => {
  const response = await app.inject({
    method: "PUT",
    url: "/v1/ai-consent",
    headers,
    payload: {
      version: currentAIConsentVersion,
      consentedAt: "2026-09-04T09:10:11.000Z",
    },
  });
  expect(response.statusCode).toBe(200);
};

describe("Backend + PostgreSQL integration", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("creates, deduplicates, updates, tags, syncs and cascades recipes", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toEqual({
      status: "ok",
    });
    const headers = { authorization: "Bearer user-a" };
    await grantAIConsent(app, headers);
    const create = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers,
      payload: { url: "https://example.com/recipe?utm_source=test" },
    });
    expect(create.statusCode).toBe(201);
    const recipeId = create.json().id as string;
    expect(enqueued).toContain(recipeId);

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers,
      payload: { url: "https://example.com/recipe" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.details.recipeId).toBe(recipeId);

    await context.prisma.recipe.update({
      where: { id: recipeId },
      data: { analysisStatus: "completed" },
    });
    const beforeIngredientUpdate =
      await context.prisma.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { updatedAt: true },
      });
    await waitForClockTick();
    const update = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}`,
      headers,
      payload: {
        title: "親子丼",
        genre: "主菜",
        ingredients: [{ name: "鶏肉", amount: "200g" }],
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().ingredients).toHaveLength(1);
    expect(new Date(update.json().updatedAt).getTime()).toBeGreaterThan(
      beforeIngredientUpdate.updatedAt.getTime(),
    );

    const tagA = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers,
      payload: { name: " QUICK " },
    });
    const tagB = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers,
      payload: { name: "quick" },
    });
    expect(tagA.json().id).toBe(tagB.json().id);
    await waitForClockTick();
    const attach = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/tags`,
      headers,
      payload: { tagId: tagA.json().id },
    });
    expect(attach.json().tags).toHaveLength(1);
    expect(new Date(attach.json().updatedAt).getTime()).toBeGreaterThan(
      new Date(update.json().updatedAt).getTime(),
    );

    const otherTag = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers: { authorization: "Bearer user-b" },
      payload: { name: "private" },
    });
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/tags`,
      headers,
      payload: { tagId: otherTag.json().id },
    });
    expect(forbidden.statusCode).toBe(404);

    const sync = await app.inject({ method: "GET", url: "/v1/sync", headers });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().recipes[0].title).toBe("親子丼");
    const secondSync = await app.inject({
      method: "GET",
      url: `/v1/sync?cursor=${encodeURIComponent(sync.json().nextCursor)}`,
      headers,
    });
    expect(secondSync.json().recipes).toEqual([]);

    await waitForClockTick();
    const detach = await app.inject({
      method: "DELETE",
      url: `/v1/recipes/${recipeId}/tags/${tagA.json().id}`,
      headers,
    });
    expect(detach.statusCode).toBe(204);
    const afterDetach = await context.prisma.recipe.findUniqueOrThrow({
      where: { id: recipeId },
      select: { updatedAt: true },
    });
    expect(afterDetach.updatedAt.getTime()).toBeGreaterThan(
      new Date(attach.json().updatedAt).getTime(),
    );
    const recipeIds = await app.inject({
      method: "GET",
      url: "/v1/sync/recipe-ids",
      headers,
    });
    expect(recipeIds.statusCode).toBe(200);
    expect(recipeIds.json().recipeIds).toEqual([recipeId]);

    const remove = await app.inject({
      method: "DELETE",
      url: `/v1/recipes/${recipeId}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);
    expect(await context.prisma.ingredient.count({ where: { recipeId } })).toBe(
      0,
    );
    await app.close();
  }, 60_000);

  it("fully deletes account data without recreating a missing DB user", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const headers = { authorization: "Bearer delete-user" };
    await app.inject({ method: "GET", url: "/v1/settings", headers });
    expect(
      await context.prisma.user.count({
        where: { firebaseUid: "delete-user" },
      }),
    ).toBe(1);
    expect(
      (await app.inject({ method: "DELETE", url: "/v1/me", headers }))
        .statusCode,
    ).toBe(204);
    expect(
      await context.prisma.user.count({
        where: { firebaseUid: "delete-user" },
      }),
    ).toBe(0);
    expect(
      (await app.inject({ method: "DELETE", url: "/v1/me", headers }))
        .statusCode,
    ).toBe(204);
    expect(
      await context.prisma.user.count({
        where: { firebaseUid: "delete-user" },
      }),
    ).toBe(0);
    expect(deletedUsers.filter((uid) => uid === "delete-user")).toHaveLength(2);
    await app.close();
  });
});
