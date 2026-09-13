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
  verifyIdToken: async (token) => ({ firebaseUid: token }),
};
const firebaseUsers: FirebaseUserManager = { deleteUser: async () => {} };
const taskQueue: AnalysisTaskQueue = { enqueueRecipeAnalysis: async () => {} };
const headers = (user: string) => ({ authorization: `Bearer ${user}` });

describe("want-to-cook API", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("persists, syncs and idempotently clears want-to-cook state for an owned recipe", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const ownerHeaders = headers("want-to-cook-owner");
    const created = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: ownerHeaders,
      payload: { url: "https://example.com/want-to-cook" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().wantToCookAt).toBeNull();
    const recipeId = created.json().id as string;

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}/want-to-cook`,
      headers: headers("want-to-cook-other"),
      payload: { enabled: true },
    });
    expect(forbidden.statusCode).toBe(404);

    const enabled = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}/want-to-cook`,
      headers: ownerHeaders,
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    const firstTimestamp = enabled.json().wantToCookAt as string;
    expect(firstTimestamp).toEqual(expect.any(String));

    const enabledAgain = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}/want-to-cook`,
      headers: ownerHeaders,
      payload: { enabled: true },
    });
    expect(enabledAgain.statusCode).toBe(200);
    expect(enabledAgain.json().wantToCookAt).toBe(firstTimestamp);

    const sync = await app.inject({
      method: "GET",
      url: "/v1/sync",
      headers: ownerHeaders,
    });
    expect(sync.statusCode).toBe(200);
    expect(
      sync
        .json()
        .recipes.find((recipe: { id: string }) => recipe.id === recipeId)
        ?.wantToCookAt,
    ).toBe(firstTimestamp);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}/want-to-cook`,
      headers: ownerHeaders,
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().wantToCookAt).toBeNull();
    expect(
      (await context.prisma.recipe.findUnique({ where: { id: recipeId } }))
        ?.wantToCookAt,
    ).toBeNull();

    const invalid = await app.inject({
      method: "PATCH",
      url: `/v1/recipes/${recipeId}/want-to-cook`,
      headers: ownerHeaders,
      payload: { enabled: "yes" },
    });
    expect(invalid.statusCode).toBe(422);

    await app.close();
  });
});
