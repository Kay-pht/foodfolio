import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import schema from "../shared/recipe-schema.json" with { type: "json" };
import type { Evaluation, Recipe } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile<Recipe>(schema);

export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000()（）・,、。．.「」『』【】［］]/g, "");
}

function bigrams(value: string): Set<string> {
  const normalized = normalize(value);
  if (normalized.length < 2) return new Set([normalized]);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
}

export function textSimilarity(left: string, right: string): number {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  let overlap = 0;
  for (const item of leftSet) if (rightSet.has(item)) overlap += 1;
  return (2 * overlap) / (leftSet.size + rightSet.size || 1);
}

function normalizeIngredientName(value: string): string {
  const withoutGroupLabels = value
    .normalize("NFKC")
    .replace(/^\s*(?:\(?[A-Z]\)?|◆[^\s]+|【[^】]+】)\s+/i, "");
  return normalize(withoutGroupLabels);
}

function ingredientNameSimilarity(left: string, right: string): number {
  const leftName = normalizeIngredientName(left);
  const rightName = normalizeIngredientName(right);
  if (leftName === rightName) return 1;
  if (
    Math.min(leftName.length, rightName.length) >= 2 &&
    (leftName.includes(rightName) || rightName.includes(leftName))
  ) {
    return 0.95;
  }
  return 0;
}

function normalizedContains(left: unknown, right: unknown): boolean {
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  if (leftValue === rightValue) return true;
  return (
    Math.min(leftValue.length, rightValue.length) >= 3 &&
    (leftValue.includes(rightValue) || rightValue.includes(leftValue))
  );
}

function greedyMatches(
  expected: string[],
  actual: string[],
  similarity: (left: string, right: string) => number,
  threshold: number,
): Array<[number, number]> {
  const candidates = expected.flatMap((expectedValue, expectedIndex) =>
    actual.map((actualValue, actualIndex) => ({
      expectedIndex,
      actualIndex,
      score: similarity(expectedValue, actualValue),
    })),
  );
  candidates.sort((left, right) => right.score - left.score);
  const expectedUsed = new Set<number>();
  const actualUsed = new Set<number>();
  const matches: Array<[number, number]> = [];
  for (const candidate of candidates) {
    if (candidate.score < threshold) break;
    if (
      expectedUsed.has(candidate.expectedIndex) ||
      actualUsed.has(candidate.actualIndex)
    ) {
      continue;
    }
    expectedUsed.add(candidate.expectedIndex);
    actualUsed.add(candidate.actualIndex);
    matches.push([candidate.expectedIndex, candidate.actualIndex]);
  }
  return matches;
}

function formatSchemaErrors(
  errors: ErrorObject[] | null | undefined,
): string[] {
  return (errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`,
  );
}

export function parseAndEvaluate(
  outputText: string,
  expected: Recipe,
): { recipe: Recipe | null; evaluation: Evaluation } {
  let parsed: unknown;
  let jsonParseSuccess = true;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    jsonParseSuccess = false;
    parsed = null;
  }
  const schemaSuccess = jsonParseSuccess && validate(parsed);
  const schemaErrors = schemaSuccess
    ? []
    : jsonParseSuccess
      ? formatSchemaErrors(validate.errors)
      : ["invalid JSON"];
  const actual = schemaSuccess ? (parsed as Recipe) : null;

  if (!actual) {
    return {
      recipe: null,
      evaluation: {
        jsonParseSuccess,
        schemaSuccess: false,
        schemaErrors,
        titleMatch: false,
        servingsMatch: expected.servings === null ? null : false,
        cookingTimeMatch: expected.cookingTimeMinutes === null ? null : false,
        genreMatch: false,
        ingredientTruePositive: 0,
        ingredientFalsePositive: 0,
        ingredientFalseNegative: expected.ingredients.length,
        ingredientAmountExact: 0,
        ingredientAmountCompared: 0,
        stepTruePositive: 0,
        stepActualMatched: 0,
        stepExpectedMatched: 0,
        stepFalsePositive: 0,
        stepFalseNegative: expected.steps.length,
        hallucinationCount: 0,
      },
    };
  }

  const ingredientMatches = greedyMatches(
    expected.ingredients.map(({ name }) => name),
    actual.ingredients.map(({ name }) => name),
    ingredientNameSimilarity,
    0.95,
  );
  const amountExact = ingredientMatches.filter(
    ([expectedIndex, actualIndex]) =>
      normalize(expected.ingredients[expectedIndex]!.amount) ===
      normalize(actual.ingredients[actualIndex]!.amount),
  ).length;
  const stepActualMatched = actual.steps.filter((actualStep) =>
    expected.steps.some(
      (expectedStep) => textSimilarity(expectedStep, actualStep) >= 0.12,
    ),
  ).length;
  const stepExpectedMatched = expected.steps.filter((expectedStep) =>
    actual.steps.some(
      (actualStep) => textSimilarity(expectedStep, actualStep) >= 0.12,
    ),
  ).length;
  const ingredientFalsePositive =
    actual.ingredients.length - ingredientMatches.length;
  const ingredientFalseNegative =
    expected.ingredients.length - ingredientMatches.length;
  const stepFalsePositive = actual.steps.length - stepActualMatched;
  const stepFalseNegative = expected.steps.length - stepExpectedMatched;
  const unsupportedScalarCount =
    (expected.cookingTimeMinutes === null && actual.cookingTimeMinutes !== null
      ? 1
      : 0) +
    (expected.servings?.value === null &&
    typeof actual.servings?.value === "number"
      ? 1
      : 0);

  return {
    recipe: actual,
    evaluation: {
      jsonParseSuccess,
      schemaSuccess: true,
      schemaErrors: [],
      titleMatch: normalizedContains(actual.title, expected.title),
      servingsMatch:
        expected.servings === null
          ? null
          : expected.servings.value !== null
            ? actual.servings?.value === expected.servings.value
            : actual.servings?.value === null &&
              normalizedContains(actual.servings?.raw, expected.servings.raw),
      cookingTimeMatch:
        expected.cookingTimeMinutes === null
          ? null
          : actual.cookingTimeMinutes === expected.cookingTimeMinutes,
      genreMatch: actual.genre === expected.genre,
      ingredientTruePositive: ingredientMatches.length,
      ingredientFalsePositive,
      ingredientFalseNegative,
      ingredientAmountExact: amountExact,
      ingredientAmountCompared: ingredientMatches.length,
      stepTruePositive: Math.min(stepActualMatched, stepExpectedMatched),
      stepActualMatched,
      stepExpectedMatched,
      stepFalsePositive,
      stepFalseNegative,
      hallucinationCount:
        ingredientFalsePositive + stepFalsePositive + unsupportedScalarCount,
    },
  };
}
