import type { SourceContent } from "../../src/application/analysis/types.js";
import {
  parseAndNormalizeRecipeUrl,
  sourceTypeForUrl,
} from "../../src/domain/recipe/url.js";
import type {
  MediaExpectedKind,
  MediaExpectedRoute,
  MediaRoutingFixture,
} from "./media-fixtures.js";
import { assessYoutubeDescription } from "../../src/domain/recipe/youtube-description-sufficiency.js";

export const LIVE_MEDIA_TARGET_URL_COUNT = 100;
export const LIVE_MEDIA_CORPUS_SCHEMA_VERSION = 1;

export type LiveMediaSource =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "chatgpt"
  | "gemini";

export interface LiveMediaCorpusCase {
  id: string;
  url: string;
  source: LiveMediaSource;
  expectedKind: MediaExpectedKind;
  expectedRoute: MediaExpectedRoute | null;
  rationale: string;
}

export interface LiveMediaCorpus {
  schemaVersion: typeof LIVE_MEDIA_CORPUS_SCHEMA_VERSION;
  cases: LiveMediaCorpusCase[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function expectedKind(value: unknown): MediaExpectedKind {
  if (value === "recipe" || value === "non-recipe") return value;
  throw new Error("expectedKind must be recipe or non-recipe");
}

function expectedRoute(value: unknown): MediaExpectedRoute | null {
  if (
    value === null ||
    value === "zai" ||
    value === "gemini" ||
    value === "text" ||
    value === "media"
  ) {
    return value;
  }
  throw new Error("expectedRoute must be zai, gemini, text, media, or null");
}

function assertRouteForSource(
  source: LiveMediaSource,
  route: MediaExpectedRoute | null,
): void {
  if (source === "youtube") {
    if (route === "zai" || route === "gemini") return;
    throw new Error("YouTube cases require expectedRoute zai or gemini");
  }
  if (source === "instagram" || source === "tiktok") {
    if (route === "text" || route === "media") return;
    throw new Error(
      "Instagram/TikTok cases require expectedRoute text or media",
    );
  }
  if (route !== null) {
    throw new Error("ChatGPT/Gemini cases require expectedRoute null");
  }
}

function liveSourceForUrl(url: URL): LiveMediaSource {
  const source = sourceTypeForUrl(url);
  if (
    source === "youtube" ||
    source === "instagram" ||
    source === "tiktok" ||
    source === "chatgpt" ||
    source === "gemini"
  ) {
    return source;
  }
  throw new Error(
    `unsupported live-media source: ${source}; use YouTube, Instagram, TikTok, ChatGPT share, or Gemini share URLs`,
  );
}

function parseCase(value: unknown, index: number): LiveMediaCorpusCase {
  const item = record(value);
  if (!item) throw new Error(`cases[${index}] must be an object`);

  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(id)) {
    throw new Error(
      `cases[${index}].id must match /^[a-z0-9][a-z0-9_-]{0,79}$/`,
    );
  }

  const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
  if (!rawUrl) throw new Error(`cases[${index}].url is required`);
  const parsed = parseAndNormalizeRecipeUrl(rawUrl);
  const normalizedUrl = new URL(parsed.normalizedUrl);
  const source = liveSourceForUrl(normalizedUrl);

  const kind = expectedKind(item.expectedKind);
  const route = expectedRoute(item.expectedRoute);
  assertRouteForSource(source, route);

  const rationale =
    typeof item.rationale === "string" ? item.rationale.trim() : "";
  if (!rationale)
    throw new Error(`cases[${index}].rationale must be non-empty`);

  return {
    id,
    url: normalizedUrl.toString(),
    source,
    expectedKind: kind,
    expectedRoute: route,
    rationale,
  };
}

export function parseLiveMediaCorpus(value: unknown): LiveMediaCorpus {
  const root = record(value);
  if (!root) throw new Error("live media corpus must be a JSON object");
  if (root.schemaVersion !== LIVE_MEDIA_CORPUS_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion must be ${LIVE_MEDIA_CORPUS_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(root.cases) || root.cases.length === 0) {
    throw new Error("cases must be a non-empty array");
  }

  const cases = root.cases.map(parseCase);
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`);
    if (urls.has(item.url))
      throw new Error(`duplicate normalized URL: ${item.url}`);
    ids.add(item.id);
    urls.add(item.url);
  }

  return {
    schemaVersion: LIVE_MEDIA_CORPUS_SCHEMA_VERSION,
    cases,
  };
}

export function evaluationFixtureForLiveCase(
  item: LiveMediaCorpusCase,
  source: SourceContent,
): MediaRoutingFixture {
  if (source.sourceType !== item.source) {
    throw new Error(
      `source type changed for ${item.id}: expected ${item.source}, got ${source.sourceType}`,
    );
  }

  const redactedInput = source.textForAi
    ? "[redacted live source text]"
    : null;

  if (item.source === "youtube") {
    if (item.expectedRoute !== "zai" && item.expectedRoute !== "gemini") {
      throw new Error(`invalid YouTube expectedRoute for ${item.id}`);
    }
    return {
      id: item.id,
      platform: "youtube",
      expectedKind: item.expectedKind,
      expectedRoute: item.expectedRoute,
      provenance: "live-url",
      rationale: item.rationale,
      input: redactedInput,
      title: "",
      description: "",
      youtubeSufficiencyOverride: assessYoutubeDescription(
        source.youtubeDescription ?? "",
      ),
    };
  }

  if (item.source === "instagram" || item.source === "tiktok") {
    if (item.expectedRoute !== "text" && item.expectedRoute !== "media") {
      throw new Error(`invalid social expectedRoute for ${item.id}`);
    }
    return {
      id: item.id,
      platform: item.source,
      expectedKind: item.expectedKind,
      expectedRoute: item.expectedRoute,
      provenance: "live-url",
      rationale: item.rationale,
      input: redactedInput,
    };
  }

  if (item.expectedRoute !== null) {
    throw new Error(`invalid AI-chat expectedRoute for ${item.id}`);
  }
  return {
    id: item.id,
    platform: "ai-chat",
    channel: item.source,
    expectedKind: item.expectedKind,
    expectedRoute: null,
    provenance: "live-url",
    rationale: item.rationale,
    input: redactedInput,
  };
}
