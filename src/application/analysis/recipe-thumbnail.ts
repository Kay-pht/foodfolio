import type {
  GeneratedRecipeImageStore,
  PublishedGeneratedRecipeImage,
  RecipeExtractionResult,
  RecipeThumbnailGenerator,
  SourceContent,
} from "./types.js";

export interface AiSharedRecipeThumbnailResult {
  imageUrl: string | null;
  publishedImage: PublishedGeneratedRecipeImage | null;
}

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
  generator?: RecipeThumbnailGenerator | undefined;
  store?: GeneratedRecipeImageStore | undefined;
  log: (fields: Record<string, unknown>, message: string) => void;
}): Promise<AiSharedRecipeThumbnailResult> {
  const { recipeId, source, result, generator, store, log } = options;
  if (!shouldGenerateAiSharedRecipeThumbnail(source, result))
    return { imageUrl: source.imageUrl, publishedImage: null };
  if (!generator || !store)
    return { imageUrl: source.imageUrl, publishedImage: null };

  try {
    const image = await generator.generate(result.recipe);
    const publishedImage = await store.publish(recipeId, image);
    return { imageUrl: publishedImage.url, publishedImage };
  } catch (error) {
    log(
      {
        recipeId,
        errorCode: "AI_SHARED_THUMBNAIL_GENERATION_FAILED",
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "AI shared recipe thumbnail generation failed",
    );
    return { imageUrl: source.imageUrl, publishedImage: null };
  }
}
