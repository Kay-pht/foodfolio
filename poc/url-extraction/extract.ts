import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { RecipeJsonLd, UrlCase, UrlExtractionResult } from "./types.js";

const USER_AGENT =
  "foodfolio-poc/1.0 (+https://github.com/Kay-pht/foodfolio; recipe metadata validation)";
const TIMEOUT_MS = 20_000;
const MAX_AI_INPUT_CHARS = 18_000;

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

function jsonObjectAfterMarker(
  text: string,
  marker: string,
): Record<string, unknown> | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value: unknown = JSON.parse(text.slice(start, index + 1));
          return value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractYoutubeDescription(html: string): string | null {
  const response =
    jsonObjectAfterMarker(html, "var ytInitialPlayerResponse =") ??
    jsonObjectAfterMarker(html, "ytInitialPlayerResponse =");
  const videoDetails = response?.videoDetails;
  if (!videoDetails || typeof videoDetails !== "object") return null;
  return textOrNull((videoDetails as Record<string, unknown>).shortDescription);
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
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

async function fetchOEmbed(testCase: UrlCase) {
  if (testCase.source === "youtube") {
    return fetchJson(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(testCase.url)}`,
    );
  }
  if (testCase.source === "tiktok") {
    return fetchJson(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(testCase.url)}`,
    );
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

export async function extractUrl(
  testCase: UrlCase,
): Promise<UrlExtractionResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(testCase.url, {
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
    const oembed = await fetchOEmbed(testCase);
    const fullYoutubeDescription =
      testCase.source === "youtube" ? extractYoutubeDescription(html) : null;
    const metadata = {
      title: pageMetadata.title ?? textOrNull(oembed?.title),
      description: fullYoutubeDescription ?? pageMetadata.description,
      imageUrl:
        pageMetadata.imageUrl ??
        textOrNull(oembed?.thumbnail_url ?? oembed?.author_url),
      authorName: pageMetadata.authorName ?? textOrNull(oembed?.author_name),
    };
    const recipes = extractJsonLdRecipes(html);
    const pageText = visibleText(html);
    const aiText = buildAiInput(metadata, recipes, pageText);
    const signalText = `${metadata.title ?? ""} ${metadata.description ?? ""} ${pageText.slice(0, 12_000)}`;
    const hasRecipeSignals =
      recipes.length > 0 ||
      /(材料|作り方|手順|recipe|ingredients?|instructions?|調理)/i.test(
        signalText,
      );
    const authRequiredSignal =
      /(ログインしてください|login required|sign in to continue)/i.test(
        signalText,
      );
    const jsRequiredSignal =
      pageText.length < 100 && /<script\b/i.test(html) && html.length > 500;
    const usable =
      testCase.kind === "recipe" &&
      response.ok &&
      hasRecipeSignals &&
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
        hasRecipeSignals,
        jsRequiredSignal,
        authRequiredSignal,
        extractionMethods: [
          "http-html",
          ...(recipes.length > 0 ? ["json-ld"] : []),
          ...(oembed ? ["oembed"] : []),
          ...(fullYoutubeDescription ? ["youtube-player-response"] : []),
        ],
      },
      aiInput: {
        usable,
        reason: usable
          ? "recipe signals and sufficient text are available"
          : !response.ok
            ? `HTTP ${response.status}`
            : !hasRecipeSignals
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
      aiInput: { usable: false, reason: message, text: "" },
      error: message,
    };
  }
}
