import type { SourceName, UrlExtractionResult } from "./types.js";

export type SourceClassification = "available" | "conditional" | "unsupported";

export interface SourceSummary {
  source: SourceName;
  recipeCases: number;
  aiUsableCases: number;
  imageCases: number;
  jsRequiredCases: number;
  authRequiredCases: number;
  classification: SourceClassification;
  reason: string;
}

export function classifySources(
  results: UrlExtractionResult[],
): SourceSummary[] {
  const recipeResults = results.filter(({ kind }) => kind === "recipe");
  const sources = [
    ...new Set(recipeResults.map(({ source }) => source)),
  ].sort();
  return sources.map((source) => {
    const items = recipeResults.filter((item) => item.source === source);
    const aiUsableCases = items.filter(({ aiInput }) => aiInput.usable).length;
    const classification =
      aiUsableCases === items.length
        ? "available"
        : aiUsableCases > 0
          ? "conditional"
          : "unsupported";
    return {
      source,
      recipeCases: items.length,
      aiUsableCases,
      imageCases: items.filter(({ metadata }) => metadata.imageUrl !== null)
        .length,
      jsRequiredCases: items.filter(({ evidence }) => evidence.jsRequiredSignal)
        .length,
      authRequiredCases: items.filter(
        ({ evidence }) => evidence.authRequiredSignal,
      ).length,
      classification,
      reason:
        classification === "available"
          ? `${aiUsableCases}/${items.length} recipe URLs produced AI-usable text`
          : classification === "conditional"
            ? `${aiUsableCases}/${items.length} recipe URLs produced AI-usable text`
            : `0/${items.length} recipe URLs produced sufficient recipe text`,
    };
  });
}
