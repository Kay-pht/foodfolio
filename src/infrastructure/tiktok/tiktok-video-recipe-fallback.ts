import type {
  SourceContent,
  TemporaryVideoStore,
  TikTokVideoDownloader,
  TikTokVideoRecipeFallback,
  VideoRecipeExtractor,
} from "../../application/analysis/types.js";

export class ProductionTikTokVideoRecipeFallback implements TikTokVideoRecipeFallback {
  constructor(
    private readonly downloader: TikTokVideoDownloader,
    private readonly videoStore: TemporaryVideoStore,
    private readonly recipeExtractor: VideoRecipeExtractor,
  ) {}

  async extract(input: SourceContent) {
    const downloaded = await this.downloader.download(
      new URL(input.resolvedUrl),
    );
    let published: Awaited<ReturnType<TemporaryVideoStore["publish"]>> | null =
      null;
    try {
      published = await this.videoStore.publish(downloaded.filePath);
      return await this.recipeExtractor.extractVideo(input, published.url);
    } finally {
      await Promise.allSettled([
        ...(published ? [published.dispose()] : []),
        downloaded.dispose(),
      ]);
    }
  }
}
