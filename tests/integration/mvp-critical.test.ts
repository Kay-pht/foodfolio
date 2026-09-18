import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
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
  verifyIdToken: async (token) => {
    if (token === "invalid") throw new Error("invalid token");
    return { firebaseUid: token };
  },
};
const noOpFirebase: FirebaseUserManager = { deleteUser: async () => {} };
const noOpQueue: AnalysisTaskQueue = { enqueueRecipeAnalysis: async () => {} };
const headers = (user: string) => ({ authorization: `Bearer ${user}` });

describe("MVP critical API integration", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("rejects missing, empty and invalid authentication", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/recipes" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/recipes",
          headers: { authorization: "Bearer " },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/recipes",
          headers: headers("invalid"),
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("creates recipes without AI consent and no longer exposes the consent API", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("no-ai-consent-user");

    const consent = await app.inject({
      method: "GET",
      url: "/v1/ai-consent",
      headers: userHeaders,
    });
    expect(consent.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/without-ai-consent" },
    });
    expect(created.statusCode).toBe(201);

    await app.close();
  });

  it("does not expose another user's recipe through GET, PATCH or DELETE", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const ownerHeaders = headers("owner-user");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: ownerHeaders,
      payload: { url: "https://example.com/private-recipe" },
    });
    const id = created.json().id as string;
    await context.prisma.recipe.update({
      where: { id },
      data: { analysisStatus: "completed" },
    });
    for (const request of [
      { method: "GET" as const, url: `/v1/recipes/${id}` },
      {
        method: "PATCH" as const,
        url: `/v1/recipes/${id}`,
        payload: { title: "stolen" },
      },
      { method: "DELETE" as const, url: `/v1/recipes/${id}` },
    ]) {
      expect(
        (await app.inject({ ...request, headers: headers("other-user") }))
          .statusCode,
      ).toBe(404);
    }
    expect(
      (await context.prisma.recipe.findUnique({ where: { id } }))?.title,
    ).not.toBe("stolen");
    await app.close();
  });

  it("batch fetches only the authenticated user's requested recipes", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const ownerHeaders = headers("batch-owner-user");
    const otherHeaders = headers("batch-other-user");
    const create = async (
      userHeaders: Record<string, string>,
      suffix: string,
    ) =>
      app.inject({
        method: "POST",
        url: "/v1/recipes",
        headers: userHeaders,
        payload: { url: `https://example.com/batch-${suffix}` },
      });

    const ownA = await create(ownerHeaders, "own-a");
    const ownB = await create(ownerHeaders, "own-b");
    const other = await create(otherHeaders, "other");
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes/batch-get",
      headers: ownerHeaders,
      payload: {
        ids: [
          ownA.json().id,
          other.json().id,
          ownB.json().id,
          "00000000-0000-0000-0000-000000000000",
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const recipes = response.json().recipes as Array<{
      id: string;
      originalUrl: string;
      ingredients: unknown[];
      steps: unknown[];
      tags: unknown[];
    }>;
    expect(new Set(recipes.map(({ id }) => id))).toEqual(
      new Set([ownA.json().id, ownB.json().id]),
    );
    expect(recipes.every((recipe) => Array.isArray(recipe.ingredients))).toBe(
      true,
    );
    expect(recipes.every((recipe) => Array.isArray(recipe.steps))).toBe(true);
    expect(recipes.every((recipe) => Array.isArray(recipe.tags))).toBe(true);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/recipes/batch-get",
          headers: ownerHeaders,
          payload: { ids: [] },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/recipes/batch-get",
          headers: ownerHeaders,
          payload: {
            ids: Array(101).fill("00000000-0000-0000-0000-000000000000"),
          },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/recipes/batch-get",
          headers: ownerHeaders,
          payload: { ids: "not-an-array" },
        })
      ).statusCode,
    ).toBe(422);

    await app.close();
  });

  it("blocks edits while analysis is pending or processing and allows completed or failed", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("analysis-state-user");
    for (const [status, expected] of [
      ["pending", 409],
      ["processing", 409],
      ["completed", 200],
      ["failed", 200],
    ] as const) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/recipes",
        headers: userHeaders,
        payload: { url: `https://example.com/state-${status}` },
      });
      const id = created.json().id as string;
      await context.prisma.recipe.update({
        where: { id },
        data: { analysisStatus: status },
      });
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/v1/recipes/${id}`,
            headers: userHeaders,
            payload: { title: `${status}-edited` },
          })
        ).statusCode,
      ).toBe(expected);
    }
    await app.close();
  });

  it("keeps a saved recipe when task enqueue fails", async () => {
    const taskQueue: AnalysisTaskQueue = {
      enqueueRecipeAnalysis: async () => {
        throw new Error("queue unavailable");
      },
    };
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue,
    });
    const userHeaders = headers("enqueue-user");
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/queue-failure" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().analysisStatus).toBe("failed");
    expect(response.json().title).toBe("解析に失敗したレシピ");
    expect(
      await context.prisma.recipe.count({ where: { id: response.json().id } }),
    ).toBe(1);
    await app.close();
  });

  it("deletes all account-owned rows and permits Firebase deletion retry without recreating DB user", async () => {
    let firebaseCalls = 0;
    const firebaseUsers: FirebaseUserManager = {
      deleteUser: async () => {
        firebaseCalls += 1;
        if (firebaseCalls === 1)
          throw Object.assign(new Error("temporary"), {
            code: "auth/internal-error",
          });
      },
    };
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("cascade-delete-user");
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: userHeaders,
    });
    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "cascade-delete-user" },
    });
    const recipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/delete-all",
        normalizedUrl: "https://example.com/delete-all",
        sourceType: "web",
        ingredients: { create: { name: "鶏肉", amount: "100g", sortOrder: 0 } },
        steps: { create: { text: "焼く", sortOrder: 0 } },
      },
    });
    const tag = await context.prisma.tag.create({
      data: { userId: user.id, name: "削除", normalizedName: "削除" },
    });
    await context.prisma.recipeTag.create({
      data: { recipeId: recipe.id, tagId: tag.id },
    });
    await context.prisma.deviceToken.create({
      data: { userId: user.id, fcmToken: "cascade-token" },
    });

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/me",
          headers: userHeaders,
        })
      ).statusCode,
    ).toBe(503);
    expect(await context.prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(
      await context.prisma.recipe.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await context.prisma.ingredient.count({ where: { recipeId: recipe.id } }),
    ).toBe(0);
    expect(
      await context.prisma.recipeStep.count({ where: { recipeId: recipe.id } }),
    ).toBe(0);
    expect(
      await context.prisma.recipeTag.count({ where: { recipeId: recipe.id } }),
    ).toBe(0);
    expect(await context.prisma.tag.count({ where: { userId: user.id } })).toBe(
      0,
    );
    expect(
      await context.prisma.deviceToken.count({ where: { userId: user.id } }),
    ).toBe(0);
    expect(
      await context.prisma.userSetting.count({ where: { userId: user.id } }),
    ).toBe(0);

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/me",
          headers: userHeaders,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      await context.prisma.user.count({
        where: { firebaseUid: "cascade-delete-user" },
      }),
    ).toBe(0);
    expect(firebaseCalls).toBe(2);
    await app.close();
  });

  it("keeps sync cursor ordering stable when recipes share updatedAt and rejects malformed cursors", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("sync-boundary-user");
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: userHeaders,
    });
    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "sync-boundary-user" },
    });
    const timestamp = new Date("2026-08-29T01:00:00.000Z");
    const rows = await Promise.all(
      ["a", "b"].map((suffix) =>
        context.prisma.recipe.create({
          data: {
            userId: user.id,
            originalUrl: `https://example.com/sync-${suffix}`,
            normalizedUrl: `https://example.com/sync-${suffix}`,
            sourceType: "web",
            updatedAt: timestamp,
          },
        }),
      ),
    );
    const sync = await app.inject({
      method: "GET",
      url: "/v1/sync",
      headers: userHeaders,
    });
    expect(sync.statusCode).toBe(200);
    const syncedIDs = new Set(
      sync.json().recipes.map((recipe: { id: string }) => recipe.id),
    );
    expect(rows.every((row) => syncedIDs.has(row.id))).toBe(true);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/sync?cursor=not-a-cursor",
          headers: userHeaders,
        })
      ).statusCode,
    ).toBe(400);

    const nextRecipe = await context.prisma.recipe.create({
      data: {
        userId: user.id,
        originalUrl: "https://example.com/sync-next",
        normalizedUrl: "https://example.com/sync-next",
        sourceType: "web",
      },
    });
    const next = await app.inject({
      method: "GET",
      url: `/v1/sync?cursor=${encodeURIComponent(sync.json().nextCursor)}`,
      headers: userHeaders,
    });
    expect(
      next.json().recipes.map((recipe: { id: string }) => recipe.id),
    ).toContain(nextRecipe.id);
    await app.close();
  });

  it("covers validation boundaries for title, genre, ingredients and tag names", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("validation-user");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/validation" },
    });
    const id = created.json().id as string;
    await context.prisma.recipe.update({
      where: { id },
      data: { analysisStatus: "completed" },
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { title: "a".repeat(200) },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { title: "a".repeat(201) },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { title: " " },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { genre: "invalid" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { ingredients: {} },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/recipes/${id}`,
          headers: userHeaders,
          payload: { ingredients: [{ name: " " }] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tags",
          headers: userHeaders,
          payload: { name: "a".repeat(30) },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/tags",
          headers: userHeaders,
          payload: { name: "a".repeat(31) },
        })
      ).statusCode,
    ).toBe(422);
    await app.close();
  });

  it("moves a device token to the latest user and prevents the previous user from deleting it", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const token = "shared-device-token";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/device-token",
          headers: headers("token-user-a"),
          payload: { token },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/device-token",
          headers: headers("token-user-b"),
          payload: { token },
        })
      ).statusCode,
    ).toBe(204);
    const row = await context.prisma.deviceToken.findUniqueOrThrow({
      where: { fcmToken: token },
      include: { user: true },
    });
    expect(row.user.firebaseUid).toBe("token-user-b");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/device-token",
          headers: headers("token-user-a"),
          payload: { token },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      await context.prisma.deviceToken.count({ where: { fcmToken: token } }),
    ).toBe(1);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/device-token",
          headers: headers("token-user-b"),
          payload: { token },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      await context.prisma.deviceToken.count({ where: { fcmToken: token } }),
    ).toBe(0);
    await app.close();
  });
});
