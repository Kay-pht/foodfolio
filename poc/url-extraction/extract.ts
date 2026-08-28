import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { RecipeJsonLd, UrlCase, UrlExtractionResult } from "./types.js";

const USER_AGENT =
  "foodfolio-poc/1.0 (+https://github.com/Kay-pht/foodfolio; recipe metadata validation)";
const TIMEOUT_MS = 20_000;
const MAX_AI_INPUT_CHARS = 18_000;
const YOUTUBE_DATA_API_URL = "https://www.googleapis.com/youtube/v3/videos";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ExtractUrlOptions {
  youtubeApiKey?: string;
  fetchImpl?: FetchLike;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return textOrNull(item);
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return textOrNull(record.text ?? record.name);
      }
      return null;
    })
    .filter((item): item is string => item !== null);
}

function collectJsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdNodes);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const graph = collectJsonLdNodes(record["@graph"]);
  return [record, ...graph];
}

function isRecipeType(value: unknown): boolean {
  return (Array.isArray(value) ? value : [value]).some(
    (entry) => typeof entry === "string" && entry.toLowerCase() === "recipe",
  );
}

export function extractJsonLdRecipes(html: string): RecipeJsonLd[] {
  const $ = cheerio.load(html);
  const recipes: RecipeJsonLd[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      for (const node of collectJsonLdNodes(parsed)) {
        if (!isRecipeType(node["@type"])) continue;
        recipes.push({
          name: textOrNull(node.name),
          recipeYield: textOrNull(node.recipeYield),
          totalTime: textOrNull(node.totalTime),
          recipeCategory: textOrNull(node.recipeCategory),
          recipeIngredient: stringArray(node.recipeIngredient),
          recipeInstructions: stringArray(node.recipeInstructions),
        });
      }
    } catch {
      // Malformed third-party JSON-LD is recorded indirectly as no parsed recipe.
    }
  });
  return recipes;
}

function metadataFromHtml(html: string): UrlExtractionResult["metadata"] {
  const $ = cheerio.load(html);
  const pick = (...selectors: string[]) => {
    for (const selector of selectors) {
      const element = $(selector).first();
      const value = element.attr("content") ?? element.text();
      const normalized = textOrNull(value);
      if (normalized) return normalized;
    }
    return null;
  };
  return {
    title: pick(
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      "title",
    ),
    description: pick(
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ),
    imageUrl: pick('meta[property="og:image"]', 'meta[name="twitter:image"]'),
    authorName: pick('meta[name="author"]'),
  };
}

function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function normalizeYoutubeVideoId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

export function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

    if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
      return normalizeYoutubeVideoId(
        parsed.pathname.split("/").filter(Boolean)[0],
      );
    }

    const isYoutubeHost =
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtube-nocookie.com" ||
      hostname.endsWith(".youtube-nocookie.com");
    if (!isYoutubeHost) return null;

    if (parsed.pathname === "/watch") {
      return normalizeYoutubeVideoId(parsed.searchParams.get("v"));
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(segments[0] ?? "")) {
      return normalizeYoutubeVideoId(segments[1]);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchJson(
  url: string,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function fetchOEmbed(testCase: UrlCase, fetchImpl: FetchLike) {
  if (testCase.source === "tiktok") {
    return fetchJson(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(testCase.url)}`,
      fetchImpl,
    );
  }
  return null;
}

function youtubeThumbnailUrl(snippet: Record<string, unknown>): string | null {
  const thumbnails = snippet.thumbnails;
  if (!thumbnails || typeof thumbnails !== "object") return null;
  const record = thumbnails as Record<string, unknown>;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const candidate = record[key];
    if (!candidate || typeof candidate !== "object") continue;
    const url = textOrNull((candidate as Record<string, unknown>).url);
    if (url) return url;
  }
  return null;
}

function buildAiInput(
  metadata: UrlExtractionResult["metadata"],
  recipes: RecipeJsonLd[],
  pageText: string,
): string {
  const parts: string[] = [];
  if (metadata.title) parts.push(`TITLE\n${metadata.title}`);
  if (metadata.description) parts.push(`DESCRIPTION\n${metadata.description}`);
  if (recipes.length > 0) {
    parts.push(`STRUCTURED_RECIPE_DATA\n${JSON.stringify(recipes)}`);
  } else if (pageText) {
    parts.push(`PAGE_TEXT\n${pageText}`);
  }
  return parts.join("\n\n").slice(0, MAX_AI_INPUT_CHARS);
}

function hasRecipeSignals(
  metadata: UrlExtractionResult["metadata"],
  recipes: RecipeJsonLd[],
  pageText: string,
): boolean {
  if (recipes.length > 0) return true;
  const signalText = `${metadata.title ?? ""} ${metadata.description ?? ""} ${pageText.slice(0, 12_000)}`;
  return /(材料|作り方|手順|recipe|ingredients?|instructions?|調理)/i.test(
    signalText,
  );
}

function emptyResult(
  testCase: UrlCase,
  startedAt: number,
  reason: string,
): UrlExtractionResult {
  return {
    id: testCase.id,
    source: testCase.source,
    url: testCase.url,
    finalUrl: testCase.url,
    kind: testCase.kind,
    capturedAt: new Date().toISOString(),
    http: {
      ok: false,
      status: 0,
      contentType: null,
      bytes: 0,
      elapsedMs: Date.now() - startedAt,
    },
    metadata: {
      title: null,
      description: null,
      imageUrl: null,
      authorName: null,
    },
    jsonLdRecipes: [],
    evidence: {
      textLength: 0,
      textSha256: createHash("sha256").update("").digest("hex"),
      hasRecipeSignals: false,
      jsRequiredSignal: false,
      authRequiredSignal: false,
      extractionMethods: [],
    },
    aiInput: { usable: false, reason, text: "" },
    error: reason,
  };
}

async function extractYoutube(
  testCase: UrlCase,
  startedAt: number,
  apiKey: string | undefined,
  fetchImpl: FetchLike,
): Promise<UrlExtractionResult> {
  const videoId = extractYoutubeVideoId(testCase.url);
  if (!videoId) {
    return emptyResult(testCase, startedAt, "invalid YouTube video URL");
  }
  if (!apiKey?.trim()) {
    return emptyResult(
      testCase,
      startedAt,
      "YOUTUBE_API_KEY is required for YouTube Data API extraction",
    );
  }

  const apiUrl = new URL(YOUTUBE_DATA_API_URL);
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("id", videoId);
  apiUrl.searchParams.set("key", apiKey);
  apiUrl.searchParams.set(
    "fields",
    "items(id,snippet(title,description,thumbnails,channelTitle))",
  );

  try {
    const response = await fetchImpl(apiUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.text();
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ...emptyResult(
          testCase,
          startedAt,
          `YouTube Data API HTTP ${response.status}`,
        ),
        http: {
          ok: false,
          status: response.status,
          contentType: response.headers.get("content-type"),
          bytes: Buffer.byteLength(body),
          elapsedMs,
        },
      };
    }

    const parsed: unknown = JSON.parse(body);
    const items =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).items
        : null;
    const item = Array.isArray(items) ? items[0] : null;
    const snippet =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).snippet
        : null;
    if (!snippet || typeof snippet !== "object") {
      return {
        ...emptyResult(
          testCase,
          startedAt,
          "YouTube Data API returned no public video metadata",
        ),
        http: {
          ok: true,
          status: response.status,
          contentType: response.headers.get("content-type"),
          bytes: Buffer.byteLength(body),
          elapsedMs,
        },
      };
    }

    const snippetRecord = snippet as Record<string, unknown>;
    const metadata: UrlExtractionResult["metadata"] = {
      title: textOrNull(snippetRecord.title),
      description: textOrNull(snippetRecord.description),
      imageUrl: youtubeThumbnailUrl(snippetRecord),
      authorName: textOrNull(snippetRecord.channelTitle),
    };
    const recipes: RecipeJsonLd[] = [];
    const pageText = "";
    const aiText = buildAiInput(metadata, recipes, pageText);
    const recipeSignals = hasRecipeSignals(metadata, recipes, pageText);
    const usable =
      testCase.kind === "recipe" && recipeSignals && aiText.length >= 100;

    return {
      id: testCase.id,
      source: testCase.source,
      url: testCase.url,
      finalUrl: testCase.url,
      kind: testCase.kind,
      capturedAt: new Date().toISOString(),
      http: {
        ok: true,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(body),
        elapsedMs,
      },
      metadata,
      jsonLdRecipes: recipes,
      evidence: {
        textLength: aiText.length,
        textSha256: createHash("sha256").update(aiText).digest("hex"),
        hasRecipeSignals: recipeSignals,
        jsRequiredSignal: false,
        authRequiredSignal: false,
        extractionMethods: ["youtube-data-api-v3"],
      },
      aiInput: {
        usable,
        reason: usable
          ? "recipe signals and sufficient YouTube snippet metadata are available"
          : !recipeSignals
            ? "no recipe signals in YouTube snippet metadata"
            : aiText.length < 100
              ? "insufficient YouTube snippet metadata"
              : "negative control",
        text: aiText,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyResult(testCase, startedAt, message);
  }
}

export async function extractUrl(
  testCase: UrlCase,
  options: ExtractUrlOptions = {},
): Promise<UrlExtractionResult> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (testCase.source === "youtube") {
    return extractYoutube(
      testCase,
      startedAt,
      options.youtubeApiKey ?? process.env.YOUTUBE_API_KEY,
      fetchImpl,
    );
  }

  try {
    const response = await fetchImpl(testCase.url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await response.text();
    const pageMetadata = metadataFromHtml(html);
    const oembed = await fetchOEmbed(testCase, fetchImpl);
    const metadata = {
      title: pageMetadata.title ?? textOrNull(oembed?.title),
      description: pageMetadata.description,
      imageUrl:
        pageMetadata.imageUrl ??
        textOrNull(oembed?.thumbnail_url ?? oembed?.author_url),
      authorName: pageMetadata.authorName ?? textOrNull(oembed?.author_name),
    };
    const recipes = extractJsonLdRecipes(html);
    const pageText = visibleText(html);
    const aiText = buildAiInput(metadata, recipes, pageText);
    const recipeSignals = hasRecipeSignals(metadata, recipes, pageText);
    const signalText = `${metadata.title ?? ""} ${metadata.description ?? ""} ${pageText.slice(0, 12_000)}`;
    const authRequiredSignal =
      /(ログインしてください|login required|sign in to continue)/i.test(
        signalText,
      );
    const jsRequiredSignal =
      pageText.length < 100 && /<script\b/i.test(html) && html.length > 500;
    const usable =
      testCase.kind === "recipe" &&
      response.ok &&
      recipeSignals &&
      aiText.length >= 100;

    return {
      id: testCase.id,
      source: testCase.source,
      url: testCase.url,
      finalUrl: response.url,
      kind: testCase.kind,
      capturedAt: new Date().toISOString(),
      http: {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(html),
        elapsedMs: Date.now() - startedAt,
      },
      metadata,
      jsonLdRecipes: recipes,
      evidence: {
        textLength: pageText.length,
        textSha256: createHash("sha256").update(pageText).digest("hex"),
        hasRecipeSignals: recipeSignals,
        jsRequiredSignal,
        authRequiredSignal,
        extractionMethods: [
          "http-html",
          ...(recipes.length > 0 ? ["json-ld"] : []),
          ...(oembed ? ["oembed"] : []),
        ],
      },
      aiInput: {
        usable,
        reason: usable
          ? "recipe signals and sufficient text are available"
          : !response.ok
            ? `HTTP ${response.status}`
            : !recipeSignals
              ? "no recipe signals in accessible text/metadata"
              : aiText.length < 100
                ? "insufficient accessible text"
                : "negative control",
        text: aiText,
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyResult(testCase, startedAt, message);
  }
}
