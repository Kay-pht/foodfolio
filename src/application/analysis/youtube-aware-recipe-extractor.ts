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
      const textResult = await this.textExtractor.extract(input);
      if (hasRequiredRecipeContent(textResult)) return textResult;
      if (!this.geminiFallback)
        throw new AnalysisError(
          "YOUTUBE_GEMINI_FALLBACK_DISABLED",
          false,
          "YouTube description extraction was incomplete and Gemini fallback is disabled",
        );
      return combineResults(
        textResult,
        await this.geminiFallback.extract(input),
      );
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

function combineResults(
  textResult: RecipeExtractionResult,
  fallbackResult: RecipeExtractionResult,
): RecipeExtractionResult {
  return {
    ...fallbackResult,
    inputTokens: textResult.inputTokens + fallbackResult.inputTokens,
    outputTokens: textResult.outputTokens + fallbackResult.outputTokens,
    latencyMs: textResult.latencyMs + fallbackResult.latencyMs,
  };
}
