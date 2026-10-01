import { execFile } from "node:child_process";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  AnalysisError,
  type LocalMediaItem,
  type MediaCollection,
  type MediaFailureClass,
  type MediaFailureStage,
  type MediaKind,
  type MediaRetriever,
  type OrderedPublishedMedia,
  type PublishedMediaCollection,
  type PublishedMediaRetriever,
  type TemporaryMediaStore,
} from "../../application/analysis/types.js";
import { YtDlpMediaRetriever } from "../media/yt-dlp-media-retriever.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

export interface YtDlpInstagramMediaRetrieverConfig {
  binaryPath: string;
  maxAttempts: number;
  attemptTimeoutMs: number;
  retryBaseSeconds: number;
  maxRetrySeconds: number;
}

export interface InstagramMediaAsset {
  index: number;
  kind: MediaKind;
  url: string;
  httpHeaders: Record<string, string>;
}

interface ParsedInstagramMedia {
  assets: InstagramMediaAsset[];
  unavailableEntryCount: number;
}

interface DownloadedInstagramAsset {
  filePath: string;
  sizeBytes: number;
  contentType: string;
}

export type InstagramMetadataProbe = (
  binaryPath: string,
  sourceUrl: string,
  timeoutMs: number,
) => Promise<unknown>;

export type InstagramAssetDownloader = (
  asset: InstagramMediaAsset,
  workDirectory: string,
  timeoutMs: number,
) => Promise<DownloadedInstagramAsset>;

type Sleeper = (milliseconds: number) => Promise<void>;
type LocalRemover = (path: string, recursive: boolean) => Promise<void>;
type WorkDirectoryFactory = () => Promise<string>;

const defaultLocalRemover: LocalRemover = async (path, recursive) => {
  if (recursive) {
    await rm(path, { recursive: true, force: true });
    return;
  }
  await rm(path, { force: true });
};

type UnknownRecord = Record<string, unknown>;

function isTimeoutFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  const code = typeof record.code === "string" ? record.code : null;
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    (record.killed === true && record.signal === "SIGKILL")
  );
}

function metadataFailureClass(error: unknown): MediaFailureClass {
  if (error instanceof SyntaxError) return "invalid_response";
  if (isTimeoutFailure(error)) return "timeout";
  return "tool_error";
}

function mediaFailureContext(
  error: unknown,
  stage: MediaFailureStage,
  asset?: Pick<InstagramMediaAsset, "index" | "kind">,
  attempt?: number,
  maxAttempts?: number,
  failureClass?: MediaFailureClass,
): AnalysisError {
  const existing = error instanceof AnalysisError ? error : null;
  const existingDiagnostics = existing?.diagnostics ?? {};
  return new AnalysisError(
    existing?.code ?? "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
    existing?.retryable ?? false,
    existing?.message ?? "Instagram media preparation failed",
    existing?.provider,
    {
      ...existingDiagnostics,
      mediaFailureStage: existingDiagnostics.mediaFailureStage ?? stage,
      mediaFailureClass:
        existingDiagnostics.mediaFailureClass ??
        failureClass ??
        (isTimeoutFailure(error) ? "timeout" : "unknown"),
      ...(asset
        ? {
            mediaIndex: existingDiagnostics.mediaIndex ?? asset.index,
            mediaKind: existingDiagnostics.mediaKind ?? asset.kind,
          }
        : {}),
      ...(attempt !== undefined ? { mediaAttempt: attempt } : {}),
      ...(maxAttempts !== undefined ? { mediaMaxAttempts: maxAttempts } : {}),
    },
  );
}

function instagramDownloadFailure(
  asset: InstagramMediaAsset,
  stage: MediaFailureStage,
  failureClass: MediaFailureClass,
  message: string,
  httpStatus?: number,
): AnalysisError {
  return new AnalysisError(
    "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
    false,
    message,
    undefined,
    {
      mediaFailureStage: stage,
      mediaFailureClass: failureClass,
      mediaIndex: asset.index,
      mediaKind: asset.kind,
      ...(httpStatus !== undefined ? { mediaHttpStatus: httpStatus } : {}),
    },
  );
}

export class YtDlpInstagramMediaRetriever implements PublishedMediaRetriever {
  private readonly singleVideoRetriever: MediaRetriever;

  constructor(
    private readonly config: YtDlpInstagramMediaRetrieverConfig,
    private readonly mediaStore: TemporaryMediaStore,
    private readonly metadataProbe: InstagramMetadataProbe = runInstagramMetadataProbe,
    singleVideoRetriever?: MediaRetriever,
    private readonly assetDownloader: InstagramAssetDownloader = downloadInstagramAsset,
    private readonly sleep: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly removeLocal: LocalRemover = defaultLocalRemover,
    private readonly createWorkDirectory: WorkDirectoryFactory = () =>
      mkdtemp(join(tmpdir(), "foodfolio-instagram-media-")),
  ) {
    this.singleVideoRetriever =
      singleVideoRetriever ??
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
          code: "INSTAGRAM_MEDIA_URL_INVALID",
          retryable: false,
          message: "Instagram media fallback received an invalid URL",
        },
        downloadFailedError: {
          code: "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
          retryable: false,
          message: `Instagram media download failed after ${config.maxAttempts} attempts`,
        },
      });
  }

  async retrieve(url: URL): Promise<PublishedMediaCollection> {
    if (!isInstagramUrl(url))
      throw new AnalysisError(
        "INSTAGRAM_MEDIA_URL_INVALID",
        false,
        "Instagram media fallback received an invalid URL",
      );

    let workDirectory: string | null = null;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      let metadata: unknown;
      try {
        metadata = await this.metadataProbe(
          this.config.binaryPath,
          url.toString(),
          this.config.attemptTimeoutMs,
        );
      } catch (error) {
        const failure = new AnalysisError(
          "INSTAGRAM_MEDIA_METADATA_FAILED",
          true,
          "Instagram media metadata retrieval failed",
          undefined,
          {
            mediaFailureStage: "metadata_probe",
            mediaFailureClass: metadataFailureClass(error),
            mediaAttempt: attempt,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
        if (attempt === this.config.maxAttempts) {
          if (workDirectory)
            await this.removeWorkDirectory(workDirectory, attempt, true);
          throw failure;
        }
        await this.waitBeforeRetry(attempt);
        continue;
      }

      let parsed: ParsedInstagramMedia;
      try {
        parsed = parseInstagramMediaMetadata(metadata);
        assertCompleteMedia(parsed);
      } catch (error) {
        if (workDirectory)
          await this.removeWorkDirectory(workDirectory, attempt, true);
        throw mediaFailureContext(
          error,
          "metadata_probe",
          undefined,
          attempt,
          this.config.maxAttempts,
          "invalid_response",
        );
      }
      if (parsed.assets.length === 1 && parsed.assets[0]?.kind === "video") {
        if (workDirectory)
          await this.removeWorkDirectory(workDirectory, attempt, true);
        return this.retrieveAndPublishSingleVideo(url);
      }

      let currentWorkDirectory: string;
      if (workDirectory) {
        currentWorkDirectory = workDirectory;
      } else {
        try {
          currentWorkDirectory = await this.createWorkDirectory();
        } catch {
          throw new AnalysisError(
            "INTERNAL_ANALYSIS_ERROR",
            true,
            "Instagram local work directory creation failed",
            undefined,
            {
              mediaFailureStage: "local_prepare",
              mediaFailureClass: "filesystem",
              mediaAttempt: attempt,
              mediaMaxAttempts: this.config.maxAttempts,
            },
          );
        }
      }
      workDirectory = currentWorkDirectory;
      try {
        await clearWorkDirectory(currentWorkDirectory, this.removeLocal);
      } catch {
        throw new AnalysisError(
          "INTERNAL_ANALYSIS_ERROR",
          true,
          "Instagram local work directory cleanup failed",
          undefined,
          {
            mediaFailureStage: "local_cleanup",
            mediaFailureClass: "filesystem",
            mediaAttempt: attempt,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
      }
      const published: OrderedPublishedMedia[] = [];
      try {
        for (const asset of parsed.assets) {
          let downloaded: DownloadedInstagramAsset;
          try {
            downloaded = await this.assetDownloader(
              asset,
              currentWorkDirectory,
              this.config.attemptTimeoutMs,
            );
          } catch (error) {
            throw mediaFailureContext(error, "asset_download", asset);
          }

          const localMedia: LocalMediaItem = {
            index: asset.index,
            kind: asset.kind,
            ...downloaded,
          };
          let publishFailure: AnalysisError | null = null;
          try {
            const stored = await this.mediaStore.publish(localMedia);
            published.push({ ...stored, index: asset.index });
          } catch (error) {
            publishFailure = mediaFailureContext(error, "publish", asset);
          }

          try {
            await this.removeLocal(downloaded.filePath, false);
          } catch (error) {
            throw mediaFailureContext(
              error,
              "local_cleanup",
              asset,
              undefined,
              undefined,
              "filesystem",
            );
          }
          if (publishFailure) throw publishFailure;
        }

        await this.removeWorkDirectory(currentWorkDirectory, attempt);
        workDirectory = null;
        return {
          items: published,
          attempts: attempt,
          dispose: () =>
            disposePublishedMedia(
              published,
              attempt,
              this.config.maxAttempts,
            ),
        };
      } catch (error) {
        const failure = mediaFailureContext(
          error,
          "asset_download",
          undefined,
          attempt,
          this.config.maxAttempts,
        );
        try {
          await disposePublishedMedia(
            published,
            attempt,
            this.config.maxAttempts,
          );
        } catch (cleanupError) {
          const publishedCleanupFailure = mediaFailureContext(
            cleanupError,
            "published_cleanup",
            undefined,
            attempt,
            this.config.maxAttempts,
            "storage",
          );
          await this.removeWorkDirectory(currentWorkDirectory, attempt, true);
          throw publishedCleanupFailure;
        }
        if (attempt === this.config.maxAttempts) {
          await this.removeWorkDirectory(currentWorkDirectory, attempt, true);
          throw failure;
        }
        await this.waitBeforeRetry(attempt);
      }
    }

    throw new AnalysisError(
      "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      false,
      "Instagram media download failed",
      undefined,
      {
        mediaFailureStage: "asset_download",
        mediaFailureClass: "unknown",
        mediaAttempt: this.config.maxAttempts,
        mediaMaxAttempts: this.config.maxAttempts,
      },
    );
  }

  private async retrieveAndPublishSingleVideo(
    url: URL,
  ): Promise<PublishedMediaCollection> {
    let local: MediaCollection;
    try {
      local = await this.singleVideoRetriever.retrieve(url);
    } catch (error) {
      if (!(error instanceof AnalysisError))
        throw new AnalysisError(
          "INTERNAL_ANALYSIS_ERROR",
          true,
          "Instagram single-video local preparation failed",
          undefined,
          {
            mediaFailureStage: "local_prepare",
            mediaFailureClass: "filesystem",
          },
        );
      throw mediaFailureContext(
        error,
        "single_video_download",
        undefined,
        this.config.maxAttempts,
        this.config.maxAttempts,
      );
    }

    const published: OrderedPublishedMedia[] = [];
    try {
      const item = local.items[0];
      if (!item || local.items.length !== 1)
        throw new AnalysisError(
          "INSTAGRAM_MEDIA_COLLECTION_INVALID",
          false,
          "Instagram single-video fallback requires exactly one media item",
        );

      let stored: Awaited<ReturnType<TemporaryMediaStore["publish"]>>;
      try {
        stored = await this.mediaStore.publish(item);
      } catch (error) {
        throw mediaFailureContext(
          error,
          "publish",
          { index: 1, kind: "video" },
          local.attempts,
          this.config.maxAttempts,
        );
      }
      published.push({ ...stored, index: 1 });

      try {
        await local.dispose();
      } catch (error) {
        const existing = error instanceof AnalysisError ? error : null;
        throw new AnalysisError(
          existing?.code ?? "INTERNAL_ANALYSIS_ERROR",
          existing?.retryable ?? true,
          existing?.message ?? "Instagram local media cleanup failed",
          existing?.provider,
          {
            ...(existing?.diagnostics ?? {}),
            mediaFailureStage:
              existing?.diagnostics?.mediaFailureStage ?? "local_cleanup",
            mediaFailureClass:
              existing?.diagnostics?.mediaFailureClass ?? "filesystem",
            mediaIndex: existing?.diagnostics?.mediaIndex ?? 1,
            mediaKind: existing?.diagnostics?.mediaKind ?? "video",
            mediaAttempt: local.attempts,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
      }
      return {
        items: published,
        attempts: local.attempts,
        dispose: () =>
          disposePublishedMedia(
            published,
            local.attempts,
            this.config.maxAttempts,
          ),
      };
    } catch (error) {
      const [localCleanup, publishedCleanup] = await Promise.allSettled([
        local.dispose(),
        disposePublishedMedia(
          published,
          local.attempts,
          this.config.maxAttempts,
        ),
      ]);
      if (publishedCleanup.status === "rejected")
        throw new AnalysisError(
          "INSTAGRAM_MEDIA_CLEANUP_FAILED",
          true,
          "Temporary Instagram media cleanup failed",
          undefined,
          {
            mediaFailureStage: "published_cleanup",
            mediaFailureClass: "storage",
            mediaIndex: 1,
            mediaKind: "video",
            mediaAttempt: local.attempts,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
      if (localCleanup.status === "rejected")
        throw new AnalysisError(
          "INSTAGRAM_MEDIA_CLEANUP_FAILED",
          true,
          "Temporary Instagram media cleanup failed",
          undefined,
          {
            mediaFailureStage: "local_cleanup",
            mediaFailureClass: "filesystem",
            mediaIndex: 1,
            mediaKind: "video",
            mediaAttempt: local.attempts,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
      throw error;
    }
  }

  private async removeWorkDirectory(
    workDirectory: string,
    attempt: number,
    unexpectedFailureRemainsRetryable = false,
  ): Promise<void> {
    try {
      await this.removeLocal(workDirectory, true);
    } catch (error) {
      if (unexpectedFailureRemainsRetryable) {
        const existing = error instanceof AnalysisError ? error : null;
        throw new AnalysisError(
          existing?.code ?? "INTERNAL_ANALYSIS_ERROR",
          existing?.retryable ?? true,
          existing?.message ?? "Instagram local work directory cleanup failed",
          existing?.provider,
          {
            ...(existing?.diagnostics ?? {}),
            mediaFailureStage:
              existing?.diagnostics?.mediaFailureStage ?? "local_cleanup",
            mediaFailureClass:
              existing?.diagnostics?.mediaFailureClass ?? "filesystem",
            mediaAttempt: attempt,
            mediaMaxAttempts: this.config.maxAttempts,
          },
        );
      }
      throw mediaFailureContext(
        error,
        "local_cleanup",
        undefined,
        attempt,
        this.config.maxAttempts,
        "filesystem",
      );
    }
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const retrySeconds = Math.min(
      this.config.retryBaseSeconds * attempt,
      this.config.maxRetrySeconds,
    );
    await this.sleep(retrySeconds * 1000);
  }
}

async function disposePublishedMedia(
  media: OrderedPublishedMedia[],
  attempt?: number,
  maxAttempts?: number,
): Promise<void> {
  const results = await Promise.allSettled(media.map((item) => item.dispose()));
  const failureIndex = results.findIndex((result) => result.status === "rejected");
  if (failureIndex < 0) return;

  const failedItem = media[failureIndex];
  throw new AnalysisError(
    "INSTAGRAM_MEDIA_CLEANUP_FAILED",
    true,
    "Temporary Instagram media cleanup failed",
    undefined,
    {
      mediaFailureStage: "published_cleanup",
      mediaFailureClass: "storage",
      ...(failedItem
        ? {
            mediaIndex: failedItem.index,
            mediaKind: failedItem.kind,
          }
        : {}),
      ...(attempt !== undefined ? { mediaAttempt: attempt } : {}),
      ...(maxAttempts !== undefined ? { mediaMaxAttempts: maxAttempts } : {}),
    },
  );
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

export function parseInstagramMediaMetadata(
  value: unknown,
): ParsedInstagramMedia {
  const root = asRecord(value);
  if (!root)
    throw new AnalysisError(
      "INSTAGRAM_MEDIA_METADATA_INVALID",
      true,
      "Instagram media metadata is invalid",
    );
  const entries = Array.isArray(root.entries)
    ? root.entries.map(asRecord)
    : [root];
  const assets: InstagramMediaAsset[] = [];
  let unavailableEntryCount = 0;
  for (const [offset, entry] of entries.entries()) {
    if (!entry) {
      unavailableEntryCount += 1;
      continue;
    }
    const asset = mediaAssetFromEntry(entry, offset + 1);
    if (asset) assets.push(asset);
    else unavailableEntryCount += 1;
  }
  return { assets, unavailableEntryCount };
}

export async function downloadInstagramAsset(
  asset: InstagramMediaAsset,
  workDirectory: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedInstagramAsset> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(asset.url);
  } catch {
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "invalid_response",
      "Instagram media asset URL is invalid",
    );
  }
  if (sourceUrl.protocol !== "https:")
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "invalid_response",
      "Instagram media asset must use HTTPS",
    );

  let response: Response;
  try {
    response = await fetchImpl(sourceUrl, {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
        ...asset.httpHeaders,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw instagramDownloadFailure(
      asset,
      "asset_download",
      isTimeoutFailure(error) ? "timeout" : "network",
      "Instagram media request failed",
    );
  }

  if (!response.ok)
    throw instagramDownloadFailure(
      asset,
      "asset_download",
      "http_error",
      "Instagram media request returned an unsuccessful status",
      response.status,
    );
  if (!response.body)
    throw instagramDownloadFailure(
      asset,
      "asset_download",
      "body_missing",
      "Instagram media response body is missing",
      response.status,
    );

  let contentType: string;
  try {
    contentType = mediaContentType(
      asset.kind,
      response.headers.get("content-type"),
      sourceUrl,
    );
  } catch {
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "unsupported_content_type",
      "Instagram media content type is unsupported by the AI provider",
      response.status,
    );
  }

  const maxBytes = asset.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes)
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "too_large",
      "Instagram media exceeds the allowed size",
      response.status,
    );

  const outputPath = join(
    workDirectory,
    `${String(asset.index).padStart(2, "0")}-${asset.kind}${extensionForContentType(contentType)}`,
  );
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(outputPath, "w", 0o600);
  } catch {
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "filesystem",
      "Instagram media temporary file could not be opened",
      response.status,
    );
  }

  let sizeBytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw instagramDownloadFailure(
          asset,
          "asset_download",
          "body_read",
          "Instagram media response body could not be read",
          response.status,
        );
      }
      if (chunk.done) break;
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > maxBytes) {
        await reader.cancel();
        throw instagramDownloadFailure(
          asset,
          "asset_validate",
          "too_large",
          "Instagram media exceeds the allowed size",
          response.status,
        );
      }
      try {
        await handle.write(chunk.value);
      } catch {
        throw instagramDownloadFailure(
          asset,
          "asset_validate",
          "filesystem",
          "Instagram media temporary file could not be written",
          response.status,
        );
      }
    }
  } catch (error) {
    try {
      await handle.close();
      await rm(outputPath, { force: true });
    } catch {
      throw instagramDownloadFailure(
        asset,
        "local_cleanup",
        "filesystem",
        "Instagram media temporary file cleanup failed",
        response.status,
      );
    }
    throw error;
  }

  try {
    await handle.close();
  } catch {
    throw instagramDownloadFailure(
      asset,
      "local_cleanup",
      "filesystem",
      "Instagram media temporary file could not be closed",
      response.status,
    );
  }
  if (sizeBytes < 1) {
    try {
      await rm(outputPath, { force: true });
    } catch {
      throw instagramDownloadFailure(
        asset,
        "local_cleanup",
        "filesystem",
        "Instagram media temporary file cleanup failed",
        response.status,
      );
    }
    throw instagramDownloadFailure(
      asset,
      "asset_validate",
      "empty_body",
      "Instagram media download is empty",
      response.status,
    );
  }
  return { filePath: outputPath, sizeBytes, contentType };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dimensionsScore(value: UnknownRecord): number {
  const width = typeof value.width === "number" ? value.width : 0;
  const height = typeof value.height === "number" ? value.height : 0;
  return width * height;
}

function headersFrom(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function mediaAssetFromEntry(
  entry: UnknownRecord,
  index: number,
): InstagramMediaAsset | null {
  const formats = Array.isArray(entry.formats)
    ? entry.formats
        .map(asRecord)
        .filter((value): value is UnknownRecord => value !== null)
        .filter(
          (format) => asString(format.url) !== null && format.vcodec !== "none",
        )
    : [];
  const combined = formats.filter(
    (format) => format.acodec !== "none" && format.vcodec !== "none",
  );
  const video = [...(combined.length ? combined : formats)].sort(
    (a, b) => dimensionsScore(b) - dimensionsScore(a),
  )[0];
  if (video) {
    return {
      index,
      kind: "video",
      url: asString(video.url)!,
      httpHeaders: {
        ...headersFrom(entry.http_headers),
        ...headersFrom(video.http_headers),
      },
    };
  }

  const thumbnails = Array.isArray(entry.thumbnails)
    ? entry.thumbnails
        .map(asRecord)
        .filter((value): value is UnknownRecord => value !== null)
        .filter((thumbnail) => asString(thumbnail.url) !== null)
        .sort((a, b) => dimensionsScore(b) - dimensionsScore(a))
    : [];
  const image = thumbnails[0];
  return image
    ? {
        index,
        kind: "image",
        url: asString(image.url)!,
        httpHeaders: headersFrom(entry.http_headers),
      }
    : null;
}

function assertCompleteMedia(parsed: ParsedInstagramMedia): void {
  if (!parsed.assets.length || parsed.unavailableEntryCount > 0)
    throw new AnalysisError(
      "INSTAGRAM_MEDIA_UNSUPPORTED_MEDIA",
      false,
      "Instagram media fallback requires every post entry to be available",
    );
  if (parsed.assets.some((asset, offset) => asset.index !== offset + 1))
    throw new AnalysisError(
      "INSTAGRAM_MEDIA_UNSUPPORTED_MEDIA",
      false,
      "Instagram media fallback requires contiguous post ordering",
    );
}

function mediaContentType(
  kind: MediaKind,
  headerValue: string | null,
  sourceUrl: URL,
): string {
  const header = headerValue?.split(";", 1)[0]?.trim().toLowerCase();
  const extension = extname(sourceUrl.pathname).toLowerCase();
  if (kind === "image") {
    if (header === "image/jpeg" || header === "image/png") return header;
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".png") return "image/png";
  } else {
    if (
      header === "video/mp4" ||
      header === "video/quicktime" ||
      header === "video/x-matroska"
    )
      return header;
    if (extension === ".mp4") return "video/mp4";
    if (extension === ".mov") return "video/quicktime";
    if (extension === ".mkv") return "video/x-matroska";
  }
  throw new Error(
    "Instagram media content type is unsupported by the AI provider",
  );
}

function extensionForContentType(contentType: string): string {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "video/quicktime") return ".mov";
  if (contentType === "video/x-matroska") return ".mkv";
  return ".mp4";
}

function isInstagramUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "instagram.com" || host.endsWith(".instagram.com"))
  );
}

async function clearWorkDirectory(
  workDirectory: string,
  removeLocal: LocalRemover = defaultLocalRemover,
): Promise<void> {
  const entries = await readdir(workDirectory);
  await Promise.all(
    entries.map((entry) => removeLocal(join(workDirectory, entry), true)),
  );
}
