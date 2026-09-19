import type { NegativeTier } from "./discovery.js";

export const DEFAULT_TARGET_PER_KIND = 500;
export const MIN_HARD_NEGATIVE_COUNT = 350;
export const MIN_DISTINCT_SITES_PER_KIND = 3;
export const MAX_SITE_SHARE = 0.4;

export interface CorpusPolicyCase {
  kind: "recipe" | "non-recipe";
  discoverySite: string;
  negativeTier: NegativeTier | null;
}

export interface CorpusQuality {
  recipeCount: number;
  nonRecipeCount: number;
  hardNegativeCount: number;
  recipeSiteCount: number;
  nonRecipeSiteCount: number;
  maxRecipeSiteShare: number;
  maxNonRecipeSiteShare: number;
  zeroRecipeFalseRejectUpperBound95: number;
  meetsDefaultTarget: boolean;
}

function maxSiteShare(cases: CorpusPolicyCase[]): number {
  if (cases.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of cases) {
    counts.set(item.discoverySite, (counts.get(item.discoverySite) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / cases.length;
}

export function zeroFailureUpperBound95(sampleSize: number): number {
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new Error("sampleSize must be a positive integer");
  }
  return 1 - Math.pow(0.05, 1 / sampleSize);
}

export function evaluateCorpusQuality(
  cases: CorpusPolicyCase[],
  targetPerKind = DEFAULT_TARGET_PER_KIND,
): CorpusQuality {
  const recipe = cases.filter(({ kind }) => kind === "recipe");
  const nonRecipe = cases.filter(({ kind }) => kind === "non-recipe");
  const hardNegativeCount = nonRecipe.filter(
    ({ negativeTier }) => negativeTier === "hard",
  ).length;
  const recipeSiteCount = new Set(
    recipe.map(({ discoverySite }) => discoverySite),
  ).size;
  const nonRecipeSiteCount = new Set(
    nonRecipe.map(({ discoverySite }) => discoverySite),
  ).size;
  const maxRecipeSiteShare = maxSiteShare(recipe);
  const maxNonRecipeSiteShare = maxSiteShare(nonRecipe);
  const zeroRecipeFalseRejectUpperBound95 =
    recipe.length > 0 ? zeroFailureUpperBound95(recipe.length) : 1;

  return {
    recipeCount: recipe.length,
    nonRecipeCount: nonRecipe.length,
    hardNegativeCount,
    recipeSiteCount,
    nonRecipeSiteCount,
    maxRecipeSiteShare,
    maxNonRecipeSiteShare,
    zeroRecipeFalseRejectUpperBound95,
    meetsDefaultTarget:
      recipe.length >= targetPerKind &&
      nonRecipe.length >= targetPerKind &&
      hardNegativeCount >= MIN_HARD_NEGATIVE_COUNT &&
      recipeSiteCount >= MIN_DISTINCT_SITES_PER_KIND &&
      nonRecipeSiteCount >= MIN_DISTINCT_SITES_PER_KIND &&
      maxRecipeSiteShare <= MAX_SITE_SHARE &&
      maxNonRecipeSiteShare <= MAX_SITE_SHARE,
  };
}

export function siteCapForTarget(targetPerKind: number): number {
  if (!Number.isInteger(targetPerKind) || targetPerKind < 1) {
    throw new Error("targetPerKind must be a positive integer");
  }
  return Math.floor(targetPerKind * MAX_SITE_SHARE);
}
