import type { SourceType } from "../../generated/prisma/client.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
]);

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export class InvalidRecipeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRecipeUrlError";
  }
}

export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let candidate: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be")
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const segments = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(segments[0] ?? ""))
        candidate = segments[1] ?? null;
    }
  }
  return candidate && /^[A-Za-z0-9_-]{6,20}$/.test(candidate)
    ? candidate
    : null;
}

export interface TikTokPostRef {
  author: string;
  kind: "photo" | "video";
  postId: string;
}

export function tiktokPostRef(url: URL): TikTokPostRef | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const author = segments[0];
  const kind = segments[1];
  const postId = segments[2];
  if (
    !author?.startsWith("@") ||
    (kind !== "photo" && kind !== "video") ||
    !postId ||
    !/^\d{5,30}$/u.test(postId)
  )
    return null;
  return { author, kind, postId };
}

export function sourceTypeForUrl(url: URL): SourceType {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (youtubeVideoId(url)) return "youtube";
  if (host === "instagram.com" || host.endsWith(".instagram.com"))
    return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "kurashiru.com" || host.endsWith(".kurashiru.com"))
    return "kurashiru";
  if (host === "cookpad.com" || host.endsWith(".cookpad.com")) return "cookpad";
  return "web";
}

export function parseAndNormalizeRecipeUrl(input: string): {
  originalUrl: string;
  normalizedUrl: string;
  sourceType: SourceType;
} {
  if (input.length > 4096) throw new InvalidRecipeUrlError("URL is too long");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidRecipeUrlError("URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new InvalidRecipeUrlError("Only HTTP(S) URLs are allowed");
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  )
    url.port = "";
  const sourceType = sourceTypeForUrl(url);
  const videoId = youtubeVideoId(url);
  if (sourceType === "youtube" && videoId) {
    return {
      originalUrl: input,
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceType,
    };
  }
  const tiktok = tiktokPostRef(url);
  if (sourceType === "tiktok" && tiktok) {
    return {
      originalUrl: input,
      normalizedUrl: `https://www.tiktok.com/${tiktok.author}/${tiktok.kind}/${tiktok.postId}`,
      sourceType,
    };
  }
  const pairs = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(
      ([aKey, aValue], [bKey, bValue]) =>
        aKey.localeCompare(bKey) || aValue.localeCompare(bValue),
    );
  url.search = "";
  for (const [key, value] of pairs) url.searchParams.append(key, value);
  return { originalUrl: input, normalizedUrl: url.toString(), sourceType };
}
