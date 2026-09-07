import {
  AnalysisError,
  type InstagramMediaRecipeFallback,
  type MediaRecipeExtractor,
  type MediaRetriever,
  type OrderedPublishedMedia,
  type SourceContent,
  type TemporaryMediaStore,
} from "../../application/analysis/types.js";

export class ProductionInstagramMediaRecipeFallback implements InstagramMediaRecipeFallback {
  constructor(
    private readonly mediaRetriever: MediaRetriever,
    private readonly mediaStore: TemporaryMediaStore,
    private readonly recipeExtractor: MediaRecipeExtractor,
  ) {}

  async extract(input: SourceContent) {
    const media = await this.mediaRetriever.retrieve(
      new URL(input.resolvedUrl),
    );
    const published: OrderedPublishedMedia[] = [];
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

      for (const item of ordered) {
        const stored = await this.mediaStore.publish(item);
        published.push({ ...stored, index: item.index });
      }
      return await this.recipeExtractor.extractMedia(input, published);
    } finally {
      await Promise.allSettled([
        ...published.map((item) => item.dispose()),
        media.dispose(),
      ]);
    }
  }
}
