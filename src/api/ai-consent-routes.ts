import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./build-api.js";
import { AppError } from "./errors/app-error.js";

export const currentAIConsentVersion = 2;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function registerAIConsentRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): void {
  const authAndUser = [app.authenticate, app.resolveUser];

  app.get(
    "/v1/ai-consent",
    { preHandler: authAndUser },
    async (request) =>
      deps.prisma.userSetting.findUniqueOrThrow({
        where: { userId: request.appUser.id },
        select: {
          aiConsentVersion: true,
          aiConsentedAt: true,
        },
      }),
  );

  app.put(
    "/v1/ai-consent",
    { preHandler: authAndUser },
    async (request) => {
      const body = asObject(request.body);
      const version = body.version;
      const consentedAtRaw = body.consentedAt;
      if (version !== currentAIConsentVersion)
        throw new AppError(
          422,
          "INVALID_AI_CONSENT_VERSION",
          "AI consent version is not current",
        );
      if (typeof consentedAtRaw !== "string")
        throw new AppError(
          422,
          "INVALID_AI_CONSENT_TIMESTAMP",
          "AI consent timestamp is required",
        );
      const consentedAt = new Date(consentedAtRaw);
      if (Number.isNaN(consentedAt.getTime()))
        throw new AppError(
          422,
          "INVALID_AI_CONSENT_TIMESTAMP",
          "AI consent timestamp is invalid",
        );

      return deps.prisma.userSetting.update({
        where: { userId: request.appUser.id },
        data: {
          aiConsentVersion: version,
          aiConsentedAt: consentedAt,
        },
        select: {
          aiConsentVersion: true,
          aiConsentedAt: true,
        },
      });
    },
  );

  app.delete(
    "/v1/ai-consent",
    { preHandler: authAndUser },
    async (request, reply) => {
      await deps.prisma.userSetting.update({
        where: { userId: request.appUser.id },
        data: {
          aiConsentVersion: null,
          aiConsentedAt: null,
        },
      });
      return reply.status(204).send();
    },
  );
}
