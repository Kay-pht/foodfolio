import * as cheerio from "cheerio";
import { tiktokPostRef } from "../../domain/recipe/url.js";
import type { SafeHttpClient } from "./safe-http-client.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

// oEmbed can return a valid player embed without thumbnail_url. The post page
// still carries its own video cover in JSON hydration data.
export async function resolveTikTokVideoThumbnail(
  http: SafeHttpClient,
  url: URL,
  embedPostId: unknown,
): Promise<string | null> {
  try {
    const response = await http.get(url);
    const post = tiktokPostRef(new URL(response.finalUrl));
    const requestedPost = tiktokPostRef(url);
    if (
      post?.kind !== "video" ||
      (requestedPost && requestedPost.postId !== post.postId) ||
      (embedPostId !== undefined && embedPostId !== post.postId)
    )
      return null;

    const $ = cheerio.load(response.body);
    const data: unknown = JSON.parse(
      $("script#__UNIVERSAL_DATA_FOR_REHYDRATION__").first().text(),
    );
    const scope = record(record(data)?.__DEFAULT_SCOPE__);
    const detail = record(scope?.["webapp.video-detail"]);
    const item = record(record(detail?.itemInfo)?.itemStruct);
    if (item?.id !== post.postId) return null;
    const video = record(item.video);
    for (const candidate of [video?.cover, video?.originCover]) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      try {
        const image = new URL(candidate);
        if (image.protocol === "https:" && !image.username && !image.password)
          return image.toString();
      } catch {
        // An invalid cover must not prevent trying the original cover.
      }
    }
  } catch {
    // Image recovery is optional; preserve successful recipe extraction when
    // TikTok denies the page request or changes its hydration format.
  }
  return null;
}
