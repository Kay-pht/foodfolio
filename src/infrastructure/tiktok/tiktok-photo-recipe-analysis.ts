import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnalysisError,
  type LocalMediaItem,
  type MediaRecipeExtractor,
  type OrderedPublishedMedia,
  type SourceContent,
  type TemporaryMediaStore,
  type TikTokPhotoRecipeAnalysis,
} from "../../application/analysis/types.js";
import { SafeHttpClient } from "../url/safe-http-client.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface DownloadedTikTokPhoto {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
}

export type TikTokPhotoDownloader = (
  url: URL,
) => Promise<DownloadedTikTokPhoto>;

export class ProductionTikTokPhotoRecipeAnalysis implements TikTokPhotoRecipeAnalysis {
  constructor(
    private readonly mediaStore: TemporaryMediaStore,
    private readonly recipeExtractor: MediaRecipeExtractor,
    private readonly downloader: TikTokPhotoDownloader = createTikTokPhotoDownloader(
      new SafeHttpClient(),
    ),
  ) {}

  async extract(input: SourceContent) {
    const sourceUrls = input.tiktokPhotoImageUrls?.slice(0, 10) ?? [];
    if (input.tiktokMediaKind !== "photo" || !sourceUrls.length)
      throw new AnalysisError(
        "TIKTOK_PHOTO_INPUT_INVALID",
        false,
        "TikTok photo analysis requires ordered photo metadata",
      );

    const directory = await mkdtemp(join(tmpdir(), "foodfolio-tiktok-photo-"));
    const published: OrderedPublishedMedia[] = [];
    try {
      for (const sourceUrl of sourceUrls) {
        let downloaded: DownloadedTikTokPhoto;
        try {
          downloaded = await this.downloader(new URL(sourceUrl));
        } catch {
          continue;
        }
        const index = published.length + 1;
        const filePath = join(
          directory,
          `${index}${extensionFor(downloaded.contentType)}`,
        );
        try {
          await writeFile(filePath, downloaded.data, { flag: "wx" });
          const local: LocalMediaItem = {
            index,
            kind: "image",
            filePath,
            sizeBytes: downloaded.data.length,
            contentType: downloaded.contentType,
          };
          const stored = await this.mediaStore.publish(local);
          published.push({ ...stored, index });
        } catch {
          continue;
        } finally {
          await rm(filePath, { force: true });
        }
      }
      if (!published.length)
        throw new AnalysisError(
          "TIKTOK_PHOTO_MEDIA_UNAVAILABLE",
          true,
          "No TikTok photo images could be prepared for analysis",
        );
      return await this.recipeExtractor.extractMedia(input, published);
    } finally {
      await Promise.allSettled([
        rm(directory, { recursive: true, force: true }),
        ...published.map((item) => item.dispose()),
      ]);
    }
  }
}

export function createTikTokPhotoDownloader(
  http: SafeHttpClient,
): TikTokPhotoDownloader {
  return async (url) => downloadTikTokPhoto(http, url);
}

async function downloadTikTokPhoto(
  http: SafeHttpClient,
  url: URL,
): Promise<DownloadedTikTokPhoto> {
  const response = await http.getBuffer(url, MAX_IMAGE_BYTES);
  const contentType = response.contentType?.split(";", 1)[0];
  if (!isSupportedContentType(contentType))
    throw new Error("unsupported photo content type");
  const data = response.body;
  if (!data.length || data.length > MAX_IMAGE_BYTES)
    throw new Error("photo size is invalid");
  return { contentType, data };
}

function isSupportedContentType(
  value: string | undefined,
): value is DownloadedTikTokPhoto["contentType"] {
  return (
    value === "image/jpeg" || value === "image/png" || value === "image/webp"
  );
}

function extensionFor(
  contentType: DownloadedTikTokPhoto["contentType"],
): string {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  return ".webp";
}
