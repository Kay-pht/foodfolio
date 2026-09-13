import type { Prisma } from "../generated/prisma/client.js";
import { GENRE_LABELS } from "../domain/recipe/genre.js";

export const recipeInclude = {
  ingredients: { orderBy: { sortOrder: "asc" as const } },
  steps: { orderBy: { sortOrder: "asc" as const } },
  recipeTags: { include: { tag: true } },
} satisfies Prisma.RecipeInclude;

export type FullRecipe = Prisma.RecipeGetPayload<{
  include: typeof recipeInclude;
}>;

export function recipeDto(recipe: FullRecipe) {
  return {
    id: recipe.id,
    originalUrl: recipe.originalUrl,
    sourceType: recipe.sourceType,
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    servingsValue: recipe.servingsValue,
    servingsRaw: recipe.servingsRaw,
    cookingTimeMinutes: recipe.cookingTimeMinutes,
    genre: recipe.genre ? GENRE_LABELS[recipe.genre] : null,
    analysisStatus: recipe.analysisStatus,
    wantToCookAt: recipe.wantToCookAt?.toISOString() ?? null,
    ingredients: recipe.ingredients.map(({ id, name, amount, sortOrder }) => ({
      id,
      name,
      amount,
      sortOrder,
    })),
    steps: recipe.steps.map(({ id, text, sortOrder }) => ({
      id,
      text,
      sortOrder,
    })),
    tags: recipe.recipeTags.map(({ tag }) => ({
      id: tag.id,
      name: tag.name,
      createdAt: tag.createdAt.toISOString(),
    })),
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}
