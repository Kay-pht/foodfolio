import {
  AnalysisError,
  type InstagramMediaRecipeFallback,
  type MediaRecipeExtractor,
  type PublishedMediaRetriever,
  type SourceContent,
} from "../../application/analysis/types.js";

export class ProductionInstagramMediaRecipeFallback implements InstagramMediaRecipeFallback {
  constructor(
    private readonly mediaRetriever: PublishedMediaRetriever,
    private readonly recipeExtractor: MediaRecipeExtractor,
  ) {}

  async extract(input: SourceContent) {
    const media = await this.mediaRetriever.retrieve(
      new URL(input.resolvedUrl),
    );
    try {
      const ordered = [...media.items].sort((a, b) => a.index - b.index);
      if (
        !ordered.length ||
        ordered.some((item, offset) => item.index !== offset + 1)
      )
        throw new AnalysisError(
          "INSTAGRAM_MEDIA_COLLECTION_INVALID",
          false,
          "Instagram media fallback requires a complete ordered collection",
        );

      return await this.recipeExtractor.extractMedia(input, ordered);
    } finally {
      await media.dispose();
    }
  }
}
