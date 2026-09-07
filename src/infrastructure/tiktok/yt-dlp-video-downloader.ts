import type {
  DownloadedVideo,
  TikTokVideoDownloader,
} from "../../application/analysis/types.js";
import {
  runYtDlpAttempt,
  YtDlpMediaRetriever,
} from "../media/yt-dlp-media-retriever.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface YtDlpDownloaderConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
}

type AttemptRunner = (
  binaryPath: string,
  sourceUrl: string,
  outputPath: string,
  timeoutMs: number,
) => Promise<void>;

type Sleeper = (milliseconds: number) => Promise<void>;

const defaultAttemptRunner: AttemptRunner = (
  binaryPath,
  sourceUrl,
  outputPath,
  timeoutMs,
) =>
  runYtDlpAttempt(binaryPath, sourceUrl, outputPath, timeoutMs, {
    formatSelector: "b[ext=mp4]",
    maxFileSizeArgument: "100M",
  });

export class YtDlpTikTokVideoDownloader implements TikTokVideoDownloader {
  private readonly retriever: YtDlpMediaRetriever;

  constructor(
    config: YtDlpDownloaderConfig,
    runAttempt: AttemptRunner = defaultAttemptRunner,
    sleep: Sleeper = (milliseconds) =>
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
      (binaryPath, sourceUrl, outputPath, timeoutMs) =>
        runAttempt(binaryPath, sourceUrl, outputPath, timeoutMs),
      sleep,
    );
  }

  async download(url: URL): Promise<DownloadedVideo> {
    const collection = await this.retriever.retrieve(url);
    const video = collection.items[0];
    if (!video || video.kind !== "video") {
      await collection.dispose();
      throw new Error("TikTok video retriever returned no video");
    }
    return {
      filePath: video.filePath,
      sizeBytes: video.sizeBytes,
      attempts: collection.attempts,
      dispose: collection.dispose,
    };
  }
}

function isTikTokUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "tiktok.com" || host.endsWith(".tiktok.com"))
  );
}
