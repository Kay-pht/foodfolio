import type { Evaluation, ProviderName } from "./types.js";

export interface ComparisonResult {
  provider: ProviderName;
  model: string;
  elapsedMs: number | null;
  costUsd: number;
  evaluation: Evaluation | null;
  error: string | null;
}

export interface ProviderMetrics {
  provider: ProviderName;
  model: string;
  calls: number;
  successfulCalls: number;
  errorCount: number;
  jsonParseSuccessRate: number;
  schemaSuccessRate: number;
  titleMatchRate: number;
  servingsMatchRate: number | null;
  cookingTimeMatchRate: number | null;
  genreMatchRate: number;
  ingredientPrecision: number;
  ingredientRecall: number;
  ingredientAmountExactRate: number;
  stepPrecision: number;
  stepRecall: number;
  hallucinationCount: number;
  totalCostUsd: number;
  averageCostUsd: number;
  averageElapsedMs: number | null;
  passesAcceptance: boolean;
}

function rate(numerator: number, denominator: number): number {
  return numerator / (denominator || 1);
}

export function aggregateByProvider(
  results: ComparisonResult[],
): ProviderMetrics[] {
  const providers = [...new Set(results.map(({ provider }) => provider))];
  return providers.map((provider) => {
    const rows = results.filter((row) => row.provider === provider);
    const evaluations = rows
      .map(({ evaluation }) => evaluation)
      .filter((item): item is Evaluation => item !== null);
    const sum = (pick: (evaluation: Evaluation) => number) =>
      evaluations.reduce((total, evaluation) => total + pick(evaluation), 0);
    const booleanRate = (
      pick: (evaluation: Evaluation) => boolean | null,
    ): number | null => {
      const values = evaluations
        .map(pick)
        .filter((value): value is boolean => value !== null);
      return values.length === 0
        ? null
        : rate(values.filter(Boolean).length, values.length);
    };
    const truePositiveIngredients = sum(
      ({ ingredientTruePositive }) => ingredientTruePositive,
    );
    const falsePositiveIngredients = sum(
      ({ ingredientFalsePositive }) => ingredientFalsePositive,
    );
    const falseNegativeIngredients = sum(
      ({ ingredientFalseNegative }) => ingredientFalseNegative,
    );
    const truePositiveSteps = sum(({ stepTruePositive }) => stepTruePositive);
    const falsePositiveSteps = sum(
      ({ stepFalsePositive }) => stepFalsePositive,
    );
    const falseNegativeSteps = sum(
      ({ stepFalseNegative }) => stepFalseNegative,
    );
    const totalCostUsd = rows.reduce(
      (total, { costUsd }) => total + costUsd,
      0,
    );
    const elapsed = rows
      .map(({ elapsedMs }) => elapsedMs)
      .filter((value): value is number => value !== null);
    const metrics = {
      provider,
      model: rows[0]?.model ?? "unknown",
      calls: rows.length,
      successfulCalls: evaluations.length,
      errorCount: rows.filter(({ error }) => error !== null).length,
      jsonParseSuccessRate: rate(
        evaluations.filter(({ jsonParseSuccess }) => jsonParseSuccess).length,
        rows.length,
      ),
      schemaSuccessRate: rate(
        evaluations.filter(({ schemaSuccess }) => schemaSuccess).length,
        rows.length,
      ),
      titleMatchRate: rate(
        evaluations.filter(({ titleMatch }) => titleMatch).length,
        rows.length,
      ),
      servingsMatchRate: booleanRate(({ servingsMatch }) => servingsMatch),
      cookingTimeMatchRate: booleanRate(
        ({ cookingTimeMatch }) => cookingTimeMatch,
      ),
      genreMatchRate: rate(
        evaluations.filter(({ genreMatch }) => genreMatch).length,
        rows.length,
      ),
      ingredientPrecision: rate(
        truePositiveIngredients,
        truePositiveIngredients + falsePositiveIngredients,
      ),
      ingredientRecall: rate(
        truePositiveIngredients,
        truePositiveIngredients + falseNegativeIngredients,
      ),
      ingredientAmountExactRate: rate(
        sum(({ ingredientAmountExact }) => ingredientAmountExact),
        sum(({ ingredientAmountCompared }) => ingredientAmountCompared),
      ),
      stepPrecision: rate(
        truePositiveSteps,
        truePositiveSteps + falsePositiveSteps,
      ),
      stepRecall: rate(
        truePositiveSteps,
        truePositiveSteps + falseNegativeSteps,
      ),
      hallucinationCount: sum(({ hallucinationCount }) => hallucinationCount),
      totalCostUsd,
      averageCostUsd: rate(totalCostUsd, rows.length),
      averageElapsedMs:
        elapsed.length === 0
          ? null
          : elapsed.reduce((total, value) => total + value, 0) / elapsed.length,
    };
    return {
      ...metrics,
      passesAcceptance:
        metrics.errorCount === 0 &&
        metrics.jsonParseSuccessRate === 1 &&
        metrics.schemaSuccessRate === 1 &&
        metrics.hallucinationCount === 0 &&
        metrics.ingredientPrecision >= 0.9 &&
        metrics.ingredientRecall >= 0.9 &&
        metrics.ingredientAmountExactRate >= 0.85 &&
        metrics.titleMatchRate >= 0.9 &&
        (metrics.servingsMatchRate === null ||
          metrics.servingsMatchRate >= 0.9) &&
        (metrics.cookingTimeMatchRate === null ||
          metrics.cookingTimeMatchRate >= 0.9) &&
        metrics.genreMatchRate >= 0.9 &&
        metrics.stepPrecision >= 0.9 &&
        metrics.stepRecall >= 0.9,
    };
  });
}

export function selectProvider(
  metrics: ProviderMetrics[],
): ProviderMetrics | null {
  return (
    metrics
      .filter(({ passesAcceptance }) => passesAcceptance)
      .sort(
        (left, right) =>
          left.averageCostUsd - right.averageCostUsd ||
          (left.averageElapsedMs ?? Infinity) -
            (right.averageElapsedMs ?? Infinity),
      )[0] ?? null
  );
}
