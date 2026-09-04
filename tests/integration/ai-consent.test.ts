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
const enqueued: string[] = [];
const taskQueue: AnalysisTaskQueue = {
  enqueueRecipeAnalysis: async (recipeId) => {
    enqueued.push(recipeId);
  },
};
const headers = { authorization: "Bearer ai-consent-user" };

describe("AI consent API", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("persists, reads and clears the authoritative consent record", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const beforeGrant = await app.inject({
      method: "GET",
      url: "/v1/ai-consent",
      headers,
    });
    expect(beforeGrant.statusCode).toBe(200);
    expect(beforeGrant.json()).toEqual({ aiConsentedAt: null });

    const consentedAt = "2026-09-04T09:10:11.000Z";
    const granted = await app.inject({
      method: "PUT",
      url: "/v1/ai-consent",
      headers,
      payload: { consentedAt },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toEqual({ aiConsentedAt: consentedAt });

    const restored = await app.inject({
      method: "GET",
      url: "/v1/ai-consent",
      headers,
    });
    expect(restored.json()).toEqual(granted.json());

    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "ai-consent-user" },
      include: { setting: true },
    });
    expect(user.setting?.aiConsentedAt?.toISOString()).toBe(consentedAt);

    const revoked = await app.inject({
      method: "DELETE",
      url: "/v1/ai-consent",
      headers,
    });
    expect(revoked.statusCode).toBe(204);

    const setting = await context.prisma.userSetting.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(setting.aiConsentedAt).toBeNull();
    await app.close();
  });

  it("rejects missing or invalid consent timestamps", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    for (const payload of [{}, { consentedAt: "not-a-date" }]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/ai-consent",
        headers: { authorization: "Bearer invalid-ai-consent-user" },
        payload,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("INVALID_AI_CONSENT_TIMESTAMP");
    }
    await app.close();
  });

  it("blocks recipe submission until consent exists and after revocation", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const userHeaders = { authorization: "Bearer guarded-recipe-user" };
    const enqueueCount = enqueued.length;

    const withoutConsent = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/guarded-recipe" },
    });
    expect(withoutConsent.statusCode).toBe(403);
    expect(withoutConsent.json().error.code).toBe("AI_CONSENT_REQUIRED");
    expect(enqueued).toHaveLength(enqueueCount);

    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/ai-consent",
          headers: userHeaders,
          payload: { consentedAt: "2026-09-04T09:20:00.000Z" },
        })
      ).statusCode,
    ).toBe(200);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/guarded-recipe" },
    });
    expect(accepted.statusCode).toBe(201);
    expect(enqueued).toHaveLength(enqueueCount + 1);

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/ai-consent",
          headers: userHeaders,
        })
      ).statusCode,
    ).toBe(204);

    const afterRevocation = await app.inject({
      method: "POST",
      url: "/v1/recipes",
      headers: userHeaders,
      payload: { url: "https://example.com/another-guarded-recipe" },
    });
    expect(afterRevocation.statusCode).toBe(403);
    expect(afterRevocation.json().error.code).toBe("AI_CONSENT_REQUIRED");
    expect(enqueued).toHaveLength(enqueueCount + 1);
    await app.close();
  });
});
