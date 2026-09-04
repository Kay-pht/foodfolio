import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import { currentAIConsentVersion } from "../../src/api/ai-consent-routes.js";
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
const headers = { authorization: "Bearer ai-consent-user" };

describe("AI consent API", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);

  it("persists consent version and timestamp and clears them on revocation", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const consentedAt = "2026-09-04T09:10:11.000Z";

    const granted = await app.inject({
      method: "PUT",
      url: "/v1/ai-consent",
      headers,
      payload: { version: currentAIConsentVersion, consentedAt },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toEqual({
      aiConsentVersion: currentAIConsentVersion,
      aiConsentedAt: consentedAt,
    });

    const user = await context.prisma.user.findUniqueOrThrow({
      where: { firebaseUid: "ai-consent-user" },
      include: { setting: true },
    });
    expect(user.setting?.aiConsentVersion).toBe(currentAIConsentVersion);
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
    expect(setting.aiConsentVersion).toBeNull();
    expect(setting.aiConsentedAt).toBeNull();
    await app.close();
  });

  it("rejects stale consent versions", async () => {
    const app = buildApi({
      prisma: context.prisma,
      authVerifier: auth,
      firebaseUsers,
      taskQueue,
    });
    const response = await app.inject({
      method: "PUT",
      url: "/v1/ai-consent",
      headers: { authorization: "Bearer stale-ai-consent-user" },
      payload: {
        version: currentAIConsentVersion - 1,
        consentedAt: "2026-09-04T09:10:11.000Z",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INVALID_AI_CONSENT_VERSION");
    await app.close();
  });
});
