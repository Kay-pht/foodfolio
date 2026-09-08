import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("analysis admission limits", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  beforeEach(async () => {
    await context.prisma.user.deleteMany();
  });

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  async function ensureUser(firebaseUid: string) {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: headers(firebaseUid),
    });
    await app.close();
    return context.prisma.user.findUniqueOrThrow({ where: { firebaseUid } });
  }

  it("atomically accepts only 10 concurrent outstanding analyses per user", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("parallel-limit-user");
    await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: userHeaders,
    });

    const responses = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/v1/recipes",
          headers: userHeaders,
          payload: { url: `https://example.com/parallel-${index}` },
        }),
      ),
    );

    expect(
      responses.filter(({ statusCode }) => statusCode === 201),
    ).toHaveLength(10);
    const rejected = responses.filter(({ statusCode }) => statusCode === 429);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.json().error).toMatchObject({
      code: "ANALYSIS_LIMIT_EXCEEDED",
      details: { limitType: "user_outstanding", limit: 10 },
    });
    expect(
      await context.prisma.analysisAdmission.count({
        where: { finishedAt: null },
      }),
    ).toBe(10);
    await app.close();
  });

  it("does not free an outstanding slot merely because the recipe was deleted", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const userHeaders = headers("delete-bypass-user");
    const recipeIds: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/recipes",
        headers: userHeaders,
        payload: { url: `https://example.com/delete-bypass-${index}` },
      });
      expect(created.statusCode).toBe(201);
      recipeIds.push(created.json().id as string);
    }
    for (const recipeId of recipeIds) {
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/v1/recipes/${recipeId}`,
            headers: userHeaders,
          })
        ).statusCode,
      ).toBe(204);
    }

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/delete-bypass-next" },
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.json().error.details.limitType).toBe("user_outstanding");
    expect(
      await context.prisma.analysisAdmission.count({
        where: { finishedAt: null },
      }),
    ).toBe(10);
    await app.close();
  });

  it("enforces the 30-per-JST-day user limit even for finished admissions", async () => {
    const user = await ensureUser("daily-user");
    const now = new Date();
    await context.prisma.analysisAdmission.createMany({
      data: Array.from({ length: 30 }, () => ({
        userId: user.id,
        recipeId: randomUUID(),
        acceptedAt: now,
        finishedAt: now,
      })),
    });
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("daily-user"),
      payload: { url: "https://example.com/daily-over-limit" },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatchObject({
      code: "ANALYSIS_LIMIT_EXCEEDED",
      details: { limitType: "user_daily", limit: 30 },
    });
    expect(response.json().error.details.retryAt).toEqual(expect.any(String));
    await app.close();
  });

  it("enforces the 100 outstanding analyses system-wide limit", async () => {
    const otherUser = await ensureUser("global-outstanding-seed");
    await ensureUser("global-outstanding-candidate");
    await context.prisma.analysisAdmission.createMany({
      data: Array.from({ length: 100 }, () => ({
        userId: otherUser.id,
        recipeId: randomUUID(),
      })),
    });
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("global-outstanding-candidate"),
      payload: { url: "https://example.com/global-outstanding-limit" },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatchObject({
      code: "ANALYSIS_LIMIT_EXCEEDED",
      details: { limitType: "global_outstanding", limit: 100 },
    });
    await app.close();
  });

  it("enforces the 500-per-JST-day system-wide limit", async () => {
    const otherUser = await ensureUser("global-daily-seed");
    await ensureUser("global-daily-candidate");
    const now = new Date();
    await context.prisma.analysisAdmission.createMany({
      data: Array.from({ length: 500 }, () => ({
        userId: otherUser.id,
        recipeId: randomUUID(),
        acceptedAt: now,
        finishedAt: now,
      })),
    });
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers: noOpFirebase,
      taskQueue: noOpQueue,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("global-daily-candidate"),
      payload: { url: "https://example.com/global-daily-limit" },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error).toMatchObject({
      code: "ANALYSIS_LIMIT_EXCEEDED",
      details: { limitType: "global_daily", limit: 500 },
    });
    await app.close();
  });

  it("keeps the daily admission but frees the outstanding slot when enqueue fails", async () => {
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
    const response = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: headers("enqueue-failure-admission-user"),
      payload: { url: "https://example.com/enqueue-failure-admission" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().analysisStatus).toBe("failed");
    const admission = await context.prisma.analysisAdmission.findUniqueOrThrow({
      where: { recipeId: response.json().id as string },
    });
    expect(admission.finishedAt).not.toBeNull();
    expect(
      await context.prisma.analysisAdmission.count({
        where: { userId: admission.userId },
      }),
    ).toBe(1);
    await app.close();
  });
});
