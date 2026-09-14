import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./build-api.js";
import { AppError } from "./errors/app-error.js";
import { recipeDto, recipeInclude } from "./recipe-dto.js";

const authAndUser = (app: FastifyInstance) => [
  app.authenticate,
  app.resolveUser,
];

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new AppError(400, "INVALID_REQUEST", `${name} is required`);
  return value;
};

export function registerWantToCookRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): void {
  app.patch(
    "/v1/recipes/:recipeId/want-to-cook",
    { preHandler: authAndUser(app) },
    async (request) => {
      const recipeId = requireString(
        asObject(request.params).recipeId,
        "recipeId",
      );
      const enabled = asObject(request.body).enabled;
      if (typeof enabled !== "boolean")
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "enabled must be a boolean",
        );

      const changedAt = new Date();
      if (enabled) {
        await deps.prisma.recipe.updateMany({
          where: {
            id: recipeId,
            userId: request.appUser.id,
            wantToCookAt: null,
          },
          data: { wantToCookAt: changedAt, updatedAt: changedAt },
        });
      } else {
        await deps.prisma.recipe.updateMany({
          where: {
            id: recipeId,
            userId: request.appUser.id,
            wantToCookAt: { not: null },
          },
          data: { wantToCookAt: null, updatedAt: changedAt },
        });
      }

      const updated = await deps.prisma.recipe.findFirst({
        where: { id: recipeId, userId: request.appUser.id },
        include: recipeInclude,
      });
      if (!updated)
        throw new AppError(404, "NOT_FOUND", "Recipe was not found");

      return recipeDto(updated);
    },
  );
}
