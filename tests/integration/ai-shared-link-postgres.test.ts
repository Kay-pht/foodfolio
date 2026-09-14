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
const firebaseUsers: FirebaseUserManager = {
  deleteUser: async () => undefined,
};
const enqueued: string[] = [];
const taskQueue: AnalysisTaskQueue = {
  enqueueRecipeAnalysis: async (recipeId) => {
    enqueued.push(recipeId);
  },
};

const GEMINI_SHORT = "https://share.gemini.google/LHkZTOZW21nI";
const GEMINI_CANONICAL = "https://gemini.google.com/share/7c0cc2402f4e";

describe("AI shared-link PostgreSQL integration", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("canonicalizes Gemini before persistence and duplicate detection", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
      recipeUrlCanonicalizer: {
        canonicalize: async (input) =>
          input === GEMINI_SHORT ? GEMINI_CANONICAL : input,
      },
    });
    const headers = { authorization: "Bearer ai-share-user" };

    const first = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers,
      payload: { url: GEMINI_SHORT },
    });
    expect(first.statusCode).toBe(201);
    const recipeId = first.json().id as string;
    expect(enqueued).toContain(recipeId);

    await expect(
      context.prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } }),
    ).resolves.toMatchObject({
      normalizedUrl: GEMINI_CANONICAL,
      sourceType: "gemini",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers,
      payload: { url: GEMINI_CANONICAL },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.details.recipeId).toBe(recipeId);

    await app.close();
  }, 60_000);

  it("stores ChatGPT public shares as a distinct source type", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const headers = { authorization: "Bearer chatgpt-share-user" };
    const url =
      "https://chatgpt.com/share/6aa7b428-1b5c-83e8-80c8-ade0e5e863c7?utm_source=test#fragment";

    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers,
      payload: { url },
    });
    expect(response.statusCode).toBe(201);
    const recipeId = response.json().id as string;

    await expect(
      context.prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } }),
    ).resolves.toMatchObject({
      normalizedUrl:
        "https://chatgpt.com/share/6aa7b428-1b5c-83e8-80c8-ade0e5e863c7",
      sourceType: "chatgpt",
      imageUrl: null,
    });

    await app.close();
  }, 60_000);
});
