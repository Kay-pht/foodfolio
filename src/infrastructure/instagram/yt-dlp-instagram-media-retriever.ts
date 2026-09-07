import { execFile } from "node:child_process";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  AnalysisError,
  type LocalMediaItem,
  type MediaCollection,
  type MediaKind,
  type MediaRetriever,
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

type UnknownRecord = Record<string, unknown>;

export class YtDlpInstagramMediaRetriever implements MediaRetriever {
  private readonly singleVideoRetriever: MediaRetriever;

  constructor(
    private readonly config: YtDlpInstagramMediaRetrieverConfig,
    private readonly metadataProbe: InstagramMetadataProbe =
      runInstagramMetadataProbe,
    singleVideoRetriever?: MediaRetriever,
    private readonly assetDownloader: InstagramAssetDownloader =
      downloadInstagramAsset,
    private readonly sleep: Sleeper = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
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

  async retrieve(url: URL): Promise<MediaCollection> {
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
      } catch {
        if (attempt === this.config.maxAttempts) {
          if (workDirectory)
            await rm(workDirectory, { recursive: true, force: true });
          throw new AnalysisError(
            "INSTAGRAM_MEDIA_METADATA_FAILED",
            true,
            "Instagram media metadata retrieval failed",
          );
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
          await rm(workDirectory, { recursive: true, force: true });
        throw error;
      }
      if (parsed.assets.length === 1 && parsed.assets[0]?.kind === "video") {
        if (workDirectory)
          await rm(workDirectory, { recursive: true, force: true });
        return this.singleVideoRetriever.retrieve(url);
      }

      const currentWorkDirectory =
        workDirectory ??
        (await mkdtemp(join(tmpdir(), "foodfolio-instagram-media-")));
      workDirectory = currentWorkDirectory;
      await clearWorkDirectory(currentWorkDirectory);
      try {
        const items: LocalMediaItem[] = [];
        for (const asset of parsed.assets) {
          const downloaded = await this.assetDownloader(
            asset,
            currentWorkDirectory,
            this.config.attemptTimeoutMs,
          );
          items.push({
            index: asset.index,
            kind: asset.kind,
            ...downloaded,
          });
        }
        return {
          items,
          attempts: attempt,
          dispose: () =>
            rm(currentWorkDirectory, { recursive: true, force: true }),
        };
      } catch {
        if (attempt === this.config.maxAttempts) {
          await rm(currentWorkDirectory, { recursive: true, force: true });
          throw new AnalysisError(
            "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
            false,
            `Instagram media download failed after ${this.config.maxAttempts} attempts`,
          );
        }
        await this.waitBeforeRetry(attempt);
      }
    }

    throw new AnalysisError(
      "INSTAGRAM_MEDIA_DOWNLOAD_FAILED",
      false,
      "Instagram media download failed",
    );
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const retrySeconds = Math.min(
      this.config.retryBaseSeconds * attempt,
      this.config.maxRetrySeconds,
    );
    await this.sleep(retrySeconds * 1000);
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

export function parseInstagramMediaMetadata(value: unknown): ParsedInstagramMedia {
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
  const sourceUrl = new URL(asset.url);
  if (sourceUrl.protocol !== "https:")
    throw new Error("Instagram media asset must use HTTPS");
  const response = await fetchImpl(sourceUrl, {
    headers: {
      Referer: "https://www.instagram.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ...asset.httpHeaders,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !response.body)
    throw new Error(`Instagram media download returned HTTP ${response.status}`);

  const contentType = mediaContentType(
    asset.kind,
    response.headers.get("content-type"),
    sourceUrl,
  );
  const maxBytes = asset.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes)
    throw new Error("Instagram media exceeds the allowed size");

  const outputPath = join(
    workDirectory,
    `${String(asset.index).padStart(2, "0")}-${asset.kind}${extensionForContentType(contentType)}`,
  );
  const handle = await open(outputPath, "w", 0o600);
  let sizeBytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        await reader.cancel();
        throw new Error("Instagram media exceeds the allowed size");
      }
      await handle.write(value);
    }
  } catch (error) {
    await handle.close();
    await rm(outputPath, { force: true });
    throw error;
  }
  await handle.close();
  if (sizeBytes < 1) {
    await rm(outputPath, { force: true });
    throw new Error("Instagram media download is empty");
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
          (format) =>
            asString(format.url) !== null && format.vcodec !== "none",
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
  throw new Error("Instagram media content type is unsupported by the AI provider");
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

async function clearWorkDirectory(workDirectory: string): Promise<void> {
  const entries = await readdir(workDirectory);
  await Promise.all(
    entries.map((entry) =>
      rm(join(workDirectory, entry), { recursive: true, force: true }),
    ),
  );
}
