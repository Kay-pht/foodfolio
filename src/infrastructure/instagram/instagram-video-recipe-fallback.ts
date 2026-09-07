import {
  AnalysisError,
  type InstagramVideoRecipeFallback,
  type MediaRetriever,
  type PublishedMedia,
  type SourceContent,
  type TemporaryMediaStore,
  type VideoRecipeExtractor,
} from "../../application/analysis/types.js";

export class ProductionInstagramVideoRecipeFallback implements InstagramVideoRecipeFallback {
  constructor(
    private readonly mediaRetriever: MediaRetriever,
    private readonly mediaStore: TemporaryMediaStore,
    private readonly recipeExtractor: VideoRecipeExtractor,
  ) {}

  async extract(input: SourceContent) {
    const media = await this.mediaRetriever.retrieve(new URL(input.resolvedUrl));
    let published: PublishedMedia | null = null;
    try {
      const video = media.items[0];
      if (media.items.length !== 1 || !video || video.kind !== "video")
        throw new AnalysisError(
          "INSTAGRAM_VIDEO_MEDIA_INVALID",
          false,
          "Instagram video fallback did not return exactly one video",
        );
      published = await this.mediaStore.publish(video);
      return await this.recipeExtractor.extractVideo(input, published.url);
    } finally {
      await Promise.allSettled([
        ...(published ? [published.dispose()] : []),
        media.dispose(),
      ]);
    }
  }
}
