import { YtDlpMediaRetriever } from "../media/yt-dlp-media-retriever.js";
import type { VideoStreamPublisher } from "../media/video-stream.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface YtDlpDownloaderConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
}

export class YtDlpTikTokVideoDownloader {
  private readonly retriever: YtDlpMediaRetriever;

  constructor(
    config: YtDlpDownloaderConfig,
    sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.retriever = new YtDlpMediaRetriever(
      {
        ...config,
        maxBytes: MAX_VIDEO_BYTES,
        maxFileSizeArgument: "100M",
        workDirectoryPrefix: "foodfolio-tiktok-video-",
        outputFileName: "video.mp4",
        kind: "video",
        contentType: "video/mp4",
        formatSelector: "b[ext=mp4]",
        validateUrl: isTikTokUrl,
        invalidUrlError: {
          code: "TIKTOK_VIDEO_URL_INVALID",
          retryable: false,
          message: "TikTok video fallback received an invalid URL",
        },
        downloadFailedError: {
          code: "TIKTOK_VIDEO_DOWNLOAD_FAILED",
          retryable: false,
          message: `TikTok video download failed after ${config.maxAttempts} attempts`,
        },
      },
      undefined,
      sleep,
    );
  }

  async publish(url: URL, publish: VideoStreamPublisher) {
    const { media } = await this.retriever.publishVideo(url, publish);
    return media;
  }
}

function isTikTokUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "tiktok.com" || host.endsWith(".tiktok.com"))
  );
}
