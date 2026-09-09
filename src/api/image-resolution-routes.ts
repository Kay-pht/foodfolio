import type { FastifyInstance } from "fastify";
import { AnalysisError } from "../application/analysis/types.js";
import type { ApiDependencies } from "./build-api.js";
import { AppError } from "./errors/app-error.js";

const authAndUser = (app: FastifyInstance) => [
  app.authenticate,
  app.resolveUser,
];

function recipeIdFromParams(params: unknown): string {
  const value =
    params && typeof params === "object"
      ? (params as Record<string, unknown>).recipeId
      : undefined;
  if (typeof value !== "string" || !value.trim())
    throw new AppError(400, "INVALID_REQUEST", "recipeId is required");
  return value;
}

export function registerImageResolutionRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): void {
  app.post(
    "/v1/recipes/:recipeId/image/resolve",
    { preHandler: authAndUser(app) },
    async (request) => {
      const recipeId = recipeIdFromParams(request.params);
      const recipe = await deps.prisma.recipe.findFirst({
        where: { id: recipeId, userId: request.appUser.id },
        select: { originalUrl: true },
      });
      if (!recipe)
        throw new AppError(404, "NOT_FOUND", "Recipe was not found");
      if (!deps.imageResolver)
        throw new AppError(
          503,
          "IMAGE_RESOLUTION_UNAVAILABLE",
          "Image resolution is unavailable",
        );

      try {
        return {
          imageUrl: await deps.imageResolver.resolveImageUrl(
            new URL(recipe.originalUrl),
          ),
        };
      } catch (error) {
        if (!(error instanceof AnalysisError)) throw error;
        request.log.info(
          { recipeId, errorCode: error.code },
          "representative image resolution unavailable",
        );
        return { imageUrl: null };
      }
    },
  );
}
