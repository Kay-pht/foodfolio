import { assessYoutubeDescription } from "../../domain/recipe/youtube-description-sufficiency.js";
import {
  AnalysisError,
  type RecipeExtractionResult,
  type RecipeExtractor,
  type SourceContent,
} from "./types.js";

function hasRequiredRecipeContent(result: RecipeExtractionResult): boolean {
  return result.recipe.ingredients.length > 0 && result.recipe.steps.length > 0;
}

export class YoutubeAwareRecipeExtractor implements RecipeExtractor {
  constructor(
    private readonly textExtractor: RecipeExtractor,
    private readonly geminiFallback: RecipeExtractor | null,
  ) {}

  async extract(input: SourceContent): Promise<RecipeExtractionResult> {
    if (input.sourceType !== "youtube")
      return this.textExtractor.extract(input);

    const assessment = assessYoutubeDescription(input.youtubeDescription ?? "");
    if (assessment.sufficient) {
      const result = await this.textExtractor.extract(input);
      if (!hasRequiredRecipeContent(result))
        throw new AnalysisError(
          "AI_RECIPE_INCOMPLETE",
          true,
          "YouTube description extraction did not contain ingredients and steps",
        );
      return result;
    }

    if (!this.geminiFallback)
      throw new AnalysisError(
        "YOUTUBE_GEMINI_FALLBACK_DISABLED",
        false,
        `YouTube description is insufficient (${assessment.reason}) and Gemini fallback is disabled`,
      );
    return this.geminiFallback.extract(input);
  }
}
