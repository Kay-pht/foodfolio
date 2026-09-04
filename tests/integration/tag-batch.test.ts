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
const noOpFirebase: FirebaseUserManager = { deleteUser: async () => {} };
const noOpQueue: AnalysisTaskQueue = { enqueueRecipeAnalysis: async () => {} };
const headers = (user: string) => ({ authorization: `Bearer ${user}` });

describe("batch tag assignment", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("attaches existing and new tags in one request", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("batch-tag-user");
    const consent = await app.inject({
      method: "PUT",
      url: "/v1/ai-consent",
      headers: userHeaders,
      payload: { consentedAt: "2026-09-04T10:45:00.000Z" },
    });
    expect(consent.statusCode).toBe(200);

    const recipeResponse = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/batch-tags" },
    });
    expect(recipeResponse.statusCode).toBe(201);
    const recipeId = recipeResponse.json().id as string;
    const existingTagResponse = await app.inject({
      method: "POST",
      url: "/v1/tags",
      headers: userHeaders,
      payload: { name: "簡単" },
    });
    const existingTagId = existingTagResponse.json().id as string;

    const batch = await app.inject({
      method: "POST",
      url: `/v1/recipes/${recipeId}/tags/batch`,
      headers: userHeaders,
      payload: {
        tagIds: [existingTagId],
        newTagNames: ["作り置き"],
      },
    });

    expect(batch.statusCode).toBe(200);
    expect(
      new Set(batch.json().tags.map((tag: { name: string }) => tag.name)),
    ).toEqual(new Set(["簡単", "作り置き"]));
    expect(await context.prisma.recipeTag.count({ where: { recipeId } })).toBe(
      2,
    );
    await app.close();
  });
});
