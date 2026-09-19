export const DEFAULT_REJECT_THRESHOLDS = [0.8, 0.9, 0.95, 0.98, 0.99] as const;

export type ExpectedRecipeKind = "recipe" | "non-recipe";

export interface JevGateObservation {
  id: string;
  expected: ExpectedRecipeKind;
  repetition: number;
  nonRecipeProbability: number;
}

export interface ThresholdMetric {
  threshold: number;
  recipeCaseCount: number;
  nonRecipeCaseCount: number;
  recipeFalseRejectCaseIds: string[];
  nonRecipeAnyRejectCaseIds: string[];
  nonRecipeConsistentRejectCaseIds: string[];
  recipeFalseRejectRate: number;
  nonRecipeAnyRejectCoverage: number;
  nonRecipeConsistentRejectCoverage: number;
}

interface CaseProbabilitySummary {
  id: string;
  expected: ExpectedRecipeKind;
  probabilities: number[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a finite probability from 0 to 1`);
  }
}

function summarizeCases(
  observations: JevGateObservation[],
): CaseProbabilitySummary[] {
  const cases = new Map<string, CaseProbabilitySummary>();

  for (const observation of observations) {
    assertProbability(observation.nonRecipeProbability, "nonRecipeProbability");
    const existing = cases.get(observation.id);
    if (existing) {
      if (existing.expected !== observation.expected) {
        throw new Error(
          `conflicting expected labels for case ${observation.id}`,
        );
      }
      existing.probabilities.push(observation.nonRecipeProbability);
      continue;
    }

    cases.set(observation.id, {
      id: observation.id,
      expected: observation.expected,
      probabilities: [observation.nonRecipeProbability],
    });
  }

  return [...cases.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function evaluateThresholds(
  observations: JevGateObservation[],
  thresholds: readonly number[] = DEFAULT_REJECT_THRESHOLDS,
): {
  caseCount: number;
  metrics: ThresholdMetric[];
  fixtureSafeCandidateThreshold: number | null;
} {
  for (const threshold of thresholds) {
    assertProbability(threshold, "threshold");
  }

  const cases = summarizeCases(observations);
  const recipeCases = cases.filter(({ expected }) => expected === "recipe");
  const nonRecipeCases = cases.filter(
    ({ expected }) => expected === "non-recipe",
  );

  const metrics = thresholds.map((threshold) => {
    const recipeFalseRejectCaseIds = recipeCases
      .filter(({ probabilities }) =>
        probabilities.some((value) => value >= threshold),
      )
      .map(({ id }) => id);
    const nonRecipeAnyRejectCaseIds = nonRecipeCases
      .filter(({ probabilities }) =>
        probabilities.some((value) => value >= threshold),
      )
      .map(({ id }) => id);
    const nonRecipeConsistentRejectCaseIds = nonRecipeCases
      .filter(
        ({ probabilities }) =>
          probabilities.length > 0 &&
          probabilities.every((value) => value >= threshold),
      )
      .map(({ id }) => id);

    return {
      threshold,
      recipeCaseCount: recipeCases.length,
      nonRecipeCaseCount: nonRecipeCases.length,
      recipeFalseRejectCaseIds,
      nonRecipeAnyRejectCaseIds,
      nonRecipeConsistentRejectCaseIds,
      recipeFalseRejectRate: ratio(
        recipeFalseRejectCaseIds.length,
        recipeCases.length,
      ),
      nonRecipeAnyRejectCoverage: ratio(
        nonRecipeAnyRejectCaseIds.length,
        nonRecipeCases.length,
      ),
      nonRecipeConsistentRejectCoverage: ratio(
        nonRecipeConsistentRejectCaseIds.length,
        nonRecipeCases.length,
      ),
    };
  });

  const fixtureSafeCandidateThreshold =
    metrics.find(
      (metric) =>
        metric.recipeFalseRejectCaseIds.length === 0 &&
        metric.nonRecipeConsistentRejectCaseIds.length > 0,
    )?.threshold ?? null;

  return {
    caseCount: cases.length,
    metrics,
    fixtureSafeCandidateThreshold,
  };
}
