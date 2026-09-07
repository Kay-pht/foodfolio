import { execFile } from "node:child_process";
import {
  AnalysisError,
  type MediaCollection,
  type MediaRetriever,
} from "../../application/analysis/types.js";
import { YtDlpMediaRetriever } from "../media/yt-dlp-media-retriever.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

export interface YtDlpInstagramVideoRetrieverConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
}

export type InstagramMetadataProbe = (
  binaryPath: string,
  sourceUrl: string,
  timeoutMs: number,
) => Promise<unknown>;

export class YtDlpInstagramVideoRetriever implements MediaRetriever {
  private readonly mediaRetriever: MediaRetriever;

  constructor(
    private readonly config: YtDlpInstagramVideoRetrieverConfig,
    private readonly metadataProbe: InstagramMetadataProbe =
      runInstagramMetadataProbe,
    mediaRetriever?: MediaRetriever,
  ) {
    this.mediaRetriever =
      mediaRetriever ??
      new YtDlpMediaRetriever({
        ...config,
        maxBytes: MAX_VIDEO_BYTES,
        maxFileSizeArgument: "100M",
        workDirectoryPrefix: "foodfolio-instagram-video-",
        outputFileName: "video.mp4",
        kind: "video",
        contentType: "video/mp4",
        formatSelector: "b[ext=mp4]",
        validateUrl: isInstagramUrl,
        invalidUrlError: {
          code: "INSTAGRAM_VIDEO_URL_INVALID",
          retryable: false,
          message: "Instagram video fallback received an invalid URL",
        },
        downloadFailedError: {
          code: "INSTAGRAM_VIDEO_DOWNLOAD_FAILED",
          retryable: false,
          message: `Instagram video download failed after ${config.maxAttempts} attempts`,
        },
      });
  }

  async retrieve(url: URL): Promise<MediaCollection> {
    if (!isInstagramUrl(url))
      throw new AnalysisError(
        "INSTAGRAM_VIDEO_URL_INVALID",
        false,
        "Instagram video fallback received an invalid URL",
      );

    let metadata: unknown;
    try {
      metadata = await this.metadataProbe(
        this.config.binaryPath,
        url.toString(),
        this.config.attemptTimeoutMs,
      );
    } catch {
      throw new AnalysisError(
        "INSTAGRAM_VIDEO_METADATA_FAILED",
        true,
        "Instagram media metadata retrieval failed",
      );
    }

    if (!isSingleVideoMetadata(metadata))
      throw new AnalysisError(
        "INSTAGRAM_VIDEO_UNSUPPORTED_MEDIA",
        false,
        "Instagram video fallback supports only a single video post",
      );

    return this.mediaRetriever.retrieve(url);
  }
}

export function runInstagramMetadataProbe(
  binaryPath: string,
  sourceUrl: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      [
        "--dump-single-json",
        "--skip-download",
        "--ignore-no-formats-error",
        "--no-cache-dir",
        "--no-progress",
        "--no-warnings",
        "--yes-playlist",
        "--extractor-retries",
        "3",
        "--sleep-requests",
        "1",
        sourceUrl,
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_METADATA_BYTES,
      },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

function isSingleVideoMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.entries)) return false;
  if (!Array.isArray(record.formats)) return false;
  return record.formats.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const format = value as Record<string, unknown>;
    if (typeof format.url !== "string" || !format.url) return false;
    if (format.vcodec === "none") return false;
    return (
      typeof format.vcodec === "string" ||
      typeof format.width === "number" ||
      typeof format.height === "number"
    );
  });
}

function isInstagramUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "instagram.com" || host.endsWith(".instagram.com"))
  );
}
