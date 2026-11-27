import type {
  PublishedMedia,
  SourceContent,
  TikTokVideoRecipeFallback,
  VideoRecipeExtractor,
} from "../../application/analysis/types.js";

export class ProductionTikTokVideoRecipeFallback implements TikTokVideoRecipeFallback {
  constructor(
    private readonly publishVideo: (url: URL) => Promise<PublishedMedia>,
    private readonly recipeExtractor: VideoRecipeExtractor,
  ) {}

  async extract(input: SourceContent) {
    const published = await this.publishVideo(new URL(input.resolvedUrl));
    try {
      return await this.recipeExtractor.extractVideo(input, published.url);
    } finally {
      await Promise.allSettled([published.dispose()]);
    }
  }
}
