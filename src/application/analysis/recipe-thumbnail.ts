import type {
  GeneratedRecipeImageStore,
  RecipeExtractionResult,
  RecipeThumbnailGenerator,
  SourceContent,
} from "./types.js";

export function hasRequiredRecipeContent(
  result: RecipeExtractionResult,
): boolean {
  return result.recipe.ingredients.length > 0 && result.recipe.steps.length > 0;
}

export function shouldGenerateAiSharedRecipeThumbnail(
  source: SourceContent,
  result: RecipeExtractionResult,
): boolean {
  return (
    (source.sourceType === "chatgpt" || source.sourceType === "gemini") &&
    source.imageUrl === null &&
    hasRequiredRecipeContent(result)
  );
}

export async function generateAiSharedRecipeThumbnail(options: {
  recipeId: string;
  source: SourceContent;
  result: RecipeExtractionResult;
  generator?: RecipeThumbnailGenerator;
  store?: GeneratedRecipeImageStore;
  log: (fields: Record<string, unknown>, message: string) => void;
}): Promise<string | null> {
  const { recipeId, source, result, generator, store, log } = options;
  if (!shouldGenerateAiSharedRecipeThumbnail(source, result))
    return source.imageUrl;
  if (!generator || !store) return source.imageUrl;

  try {
    const image = await generator.generate(result.recipe);
    return await store.publish(recipeId, image);
  } catch (error) {
    log(
      {
        recipeId,
        errorCode: "AI_SHARED_THUMBNAIL_GENERATION_FAILED",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "AI shared recipe thumbnail generation failed",
    );
    return source.imageUrl;
  }
}
