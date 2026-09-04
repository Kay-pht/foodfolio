import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./build-api.js";
import { AppError } from "./errors/app-error.js";
import { recipeDto, recipeInclude } from "./recipe-dto.js";
import { normalizeTagName } from "../domain/tag/normalize.js";

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const requireStringArray = (value: unknown, name: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new AppError(422, "VALIDATION_ERROR", `${name} must be an array`);
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim())
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `${name} must contain strings`,
      );
    return item.trim();
  });
};

export function registerTagBatchRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): void {
  app.post(
    "/v1/recipes/:recipeId/tags/batch",
    { preHandler: [app.authenticate, app.resolveUser] },
    async (request) => {
      const params = asObject(request.params);
      const recipeId = params.recipeId;
      if (typeof recipeId !== "string" || !recipeId.trim())
        throw new AppError(400, "INVALID_REQUEST", "recipeId is required");

      const body = asObject(request.body);
      const tagIds = [...new Set(requireStringArray(body.tagIds, "tagIds"))];
      const rawNewTagNames = requireStringArray(
        body.newTagNames,
        "newTagNames",
      );
      const normalizedNewTags = new Map<
        string,
        { name: string; normalizedName: string }
      >();
      try {
        for (const rawName of rawNewTagNames) {
          const normalized = normalizeTagName(rawName);
          normalizedNewTags.set(normalized.normalizedName, normalized);
        }
      } catch {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Tag name must be 1 to 30 characters",
        );
      }

      if (tagIds.length === 0 && normalizedNewTags.size === 0)
        throw new AppError(
          400,
          "INVALID_REQUEST",
          "At least one tag is required",
        );

      const ownedRecipe = await deps.prisma.recipe.findFirst({
        where: { id: recipeId, userId: request.appUser.id },
      });
      if (!ownedRecipe)
        throw new AppError(404, "NOT_FOUND", "Recipe was not found");

      await deps.prisma.$transaction(async (tx) => {
        const existingTags =
          tagIds.length > 0
            ? await tx.tag.findMany({
                where: { id: { in: tagIds }, userId: request.appUser.id },
                select: { id: true },
              })
            : [];
        if (existingTags.length !== tagIds.length)
          throw new AppError(404, "NOT_FOUND", "Tag was not found");

        const newTags = [...normalizedNewTags.values()];
        if (newTags.length > 0) {
          await tx.tag.createMany({
            data: newTags.map((tag) => ({
              userId: request.appUser.id,
              ...tag,
            })),
            skipDuplicates: true,
          });
        }
        const createdTags =
          newTags.length > 0
            ? await tx.tag.findMany({
                where: {
                  userId: request.appUser.id,
                  normalizedName: {
                    in: newTags.map((tag) => tag.normalizedName),
                  },
                },
                select: { id: true },
              })
            : [];

        const allTagIds = [
          ...new Set([...tagIds, ...createdTags.map((tag) => tag.id)]),
        ];
        if (allTagIds.length > 0) {
          await tx.recipeTag.createMany({
            data: allTagIds.map((tagId) => ({ recipeId, tagId })),
            skipDuplicates: true,
          });
          await tx.recipe.update({
            where: { id: recipeId },
            data: { updatedAt: new Date() },
          });
        }
      });

      const recipe = await deps.prisma.recipe.findFirst({
        where: { id: recipeId, userId: request.appUser.id },
        include: recipeInclude,
      });
      if (!recipe) throw new AppError(404, "NOT_FOUND", "Recipe was not found");
      return recipeDto(recipe);
    },
  );
}
