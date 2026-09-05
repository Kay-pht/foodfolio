import * as cheerio from "cheerio";
import { sourceTypeForUrl, youtubeVideoId } from "../../domain/recipe/url.js";
import {
  AnalysisError,
  type SourceContent,
  type SourceContentExtractor,
} from "../../application/analysis/types.js";
import { SafeHttpClient } from "./safe-http-client.js";

const MAX_AI_CHARS = 18_000;
const RECIPE_CONTENT_PATTERN =
  /(レシピ|材料|分量|下ごしらえ|下準備|作り方|作りかた|つくり方|つくりかた|手順|調理|recipe|ingredients?|instructions?)/i;
const normalize = (value: unknown): string | null =>
  typeof value === "string" && value.replace(/\s+/g, " ").trim()
    ? value.replace(/\s+/g, " ").trim()
    : null;

function jsonLdRecipes(html: string): unknown[] {
  const $ = cheerio.load(html);
  const recipes: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        const types = Array.isArray(record["@type"])
          ? record["@type"]
          : [record["@type"]];
        if (
          types.some(
            (type) =>
              typeof type === "string" && type.toLowerCase() === "recipe",
          )
        )
          recipes.push(record);
        if (record["@graph"]) walk(record["@graph"]);
      };
      walk(parsed);
    } catch {
      /* malformed third-party metadata is ignored */
    }
  });
  return recipes;
}

function htmlContent(html: string): {
  imageUrl: string | null;
  text: string | null;
} {
  const $ = cheerio.load(html);
  const pick = (...selectors: string[]) => {
    for (const selector of selectors) {
      const element = $(selector).first();
      const value = normalize(element.attr("content") ?? element.text());
      if (value) return value;
    }
    return null;
  };
  const title = pick(
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    "title",
  );
  const description = pick(
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  );
  const imageUrl = pick(
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  );
  const recipes = jsonLdRecipes(html);
  $("script,style,noscript,svg,nav,footer").remove();
  const pageText = normalize($("body").text());
  const parts = [
    title ? `TITLE\n${title}` : "",
    description ? `DESCRIPTION\n${description}` : "",
    recipes.length
      ? `STRUCTURED_RECIPE_DATA\n${JSON.stringify(recipes)}`
      : pageText
        ? `PAGE_TEXT\n${pageText}`
        : "",
  ].filter(Boolean);
  const text = parts.join("\n\n").slice(0, MAX_AI_CHARS);
  return {
    imageUrl,
    text: RECIPE_CONTENT_PATTERN.test(text) ? text : null,
  };
}

export class ProductionSourceContentExtractor implements SourceContentExtractor {
  constructor(
    private readonly http: SafeHttpClient,
    private readonly youtubeApiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async extract(url: URL): Promise<SourceContent> {
    const sourceType = sourceTypeForUrl(url);
    if (sourceType === "youtube") return this.extractYoutube(url);
    if (sourceType === "tiktok") return this.extractTikTok(url);
    const response = await this.http.get(url);
    const extracted = htmlContent(response.body);
    if (!extracted.text)
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "No recipe source text was found",
      );
    return {
      sourceType,
      resolvedUrl: response.finalUrl,
      imageUrl: extracted.imageUrl
        ? new URL(extracted.imageUrl, response.finalUrl).toString()
        : null,
      textForAi: extracted.text,
    };
  }
  private async extractTikTok(url: URL): Promise<SourceContent> {
    const endpoint = new URL("https://www.tiktok.com/oembed");
    endpoint.searchParams.set("url", url.toString());
    const response = await this.http.get(endpoint);
    let value: unknown;
    try {
      value = JSON.parse(response.body);
    } catch {
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "TikTok oEmbed response is invalid",
      );
    }
    if (!value || typeof value !== "object")
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "TikTok oEmbed metadata unavailable",
      );
    const record = value as Record<string, unknown>;
    const title = normalize(record.title);
    const thumbnailUrl = normalize(record.thumbnail_url);
    return {
      sourceType: "tiktok",
      resolvedUrl: url.toString(),
      imageUrl: thumbnailUrl
        ? new URL(thumbnailUrl, response.finalUrl).toString()
        : null,
      textForAi: title ? `TITLE\n${title}`.slice(0, MAX_AI_CHARS) : null,
    };
  }
  private async extractYoutube(url: URL): Promise<SourceContent> {
    const videoId = youtubeVideoId(url);
    if (!videoId)
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "YouTube video ID is invalid",
      );
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.search = new URLSearchParams({
      part: "snippet",
      id: videoId,
      key: this.youtubeApiKey,
    }).toString();
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AnalysisError(
        "SOURCE_FETCH_TIMEOUT",
        true,
        "YouTube Data API timed out",
      );
    }
    if (response.status === 429 || response.status >= 500)
      throw new AnalysisError(
        "SOURCE_FETCH_FAILED",
        true,
        "YouTube Data API unavailable",
      );
    if (!response.ok)
      throw new AnalysisError(
        "SOURCE_FETCH_FAILED",
        false,
        "YouTube Data API rejected request",
      );
    const value = (await response.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
      }>;
    };
    const snippet = value.items?.[0]?.snippet;
    if (!snippet)
      throw new AnalysisError(
        "SOURCE_CONTENT_UNAVAILABLE",
        false,
        "YouTube video metadata unavailable",
      );
    const text = [
      `TITLE\n${snippet.title ?? ""}`,
      `DESCRIPTION\n${snippet.description ?? ""}`,
    ]
      .join("\n\n")
      .slice(0, MAX_AI_CHARS);
    const thumbnails = snippet.thumbnails ?? {};
    const imageUrl =
      ["maxres", "standard", "high", "medium", "default"]
        .map((key) => thumbnails[key]?.url)
        .find(Boolean) ?? null;
    return {
      sourceType: "youtube",
      resolvedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      imageUrl,
      textForAi: text,
      youtubeDescription: snippet.description ?? "",
    };
  }
}
