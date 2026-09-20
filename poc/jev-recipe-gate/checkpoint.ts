import type { SourceName } from "../url-extraction/types.js";

export interface LegacyValidatedCase {
  id: string;
  source: SourceName;
  url: string;
  kind: "recipe" | "non-recipe";
  discoverySite: string;
  negativeTier: "hard" | "easy" | null;
  extraction: {
    ok: boolean;
    httpStatus: number;
    finalUrl: string;
    methods: string[];
    textLength: number;
    textSha256: string;
    hasRecipeSignals: boolean;
    jsonLdRecipeCount: number;
  };
}

export interface LegacyCorpusCheckpoint {
  generatedAt: string;
  discoveredCandidateCounts: {
    recipe: number;
    hardNegative: number;
    easyNegative: number;
  };
  validatedCorpus: LegacyValidatedCase[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function legacyExtraction(
  value: unknown,
): LegacyValidatedCase["extraction"] | null {
  const item = record(value);
  if (
    !item ||
    typeof item.ok !== "boolean" ||
    !nonNegativeInteger(item.httpStatus) ||
    typeof item.finalUrl !== "string" ||
    !Array.isArray(item.methods) ||
    !item.methods.every((method) => typeof method === "string") ||
    !nonNegativeInteger(item.textLength) ||
    typeof item.textSha256 !== "string" ||
    typeof item.hasRecipeSignals !== "boolean" ||
    !nonNegativeInteger(item.jsonLdRecipeCount)
  ) {
    return null;
  }

  return {
    ok: item.ok,
    httpStatus: item.httpStatus,
    finalUrl: item.finalUrl,
    methods: item.methods,
    textLength: item.textLength,
    textSha256: item.textSha256,
    hasRecipeSignals: item.hasRecipeSignals,
    jsonLdRecipeCount: item.jsonLdRecipeCount,
  };
}

function legacyCase(value: unknown): LegacyValidatedCase | null {
  const item = record(value);
  const extraction = legacyExtraction(item?.extraction);
  const source = item?.source;
  const kind = item?.kind;
  const negativeTier = item?.negativeTier;
  if (
    !item ||
    typeof item.id !== "string" ||
    (source !== "general-web" &&
      source !== "kurashiru" &&
      source !== "cookpad") ||
    typeof item.url !== "string" ||
    (kind !== "recipe" && kind !== "non-recipe") ||
    typeof item.discoverySite !== "string" ||
    (negativeTier !== null &&
      negativeTier !== "hard" &&
      negativeTier !== "easy") ||
    !extraction
  ) {
    return null;
  }

  return {
    id: item.id,
    source,
    url: item.url,
    kind,
    discoverySite: item.discoverySite,
    negativeTier,
    extraction,
  };
}

export function parseLegacyCorpusCheckpoint(
  value: unknown,
): LegacyCorpusCheckpoint | null {
  const state = record(value);
  const counts = record(state?.discoveredCandidateCounts);
  if (
    !state ||
    state.schemaVersion !== undefined ||
    state.phase !== "corpus-validation" ||
    typeof state.generatedAt !== "string" ||
    !counts ||
    !nonNegativeInteger(counts.recipe) ||
    !nonNegativeInteger(counts.hardNegative) ||
    !nonNegativeInteger(counts.easyNegative) ||
    !Array.isArray(state.validatedCorpus)
  ) {
    return null;
  }

  const validatedCorpus = state.validatedCorpus.map(legacyCase);
  if (validatedCorpus.some((item) => item === null)) return null;

  return {
    generatedAt: state.generatedAt,
    discoveredCandidateCounts: {
      recipe: counts.recipe,
      hardNegative: counts.hardNegative,
      easyNegative: counts.easyNegative,
    },
    validatedCorpus: validatedCorpus as LegacyValidatedCase[],
  };
}
