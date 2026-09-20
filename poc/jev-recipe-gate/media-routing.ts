import { assessYoutubeDescription } from "../../src/domain/recipe/youtube-description-sufficiency.js";
import type {
  MediaExpectedRoute,
  MediaRoutingFixture,
  YoutubeMediaFixture,
} from "./media-fixtures.js";

export const DEFAULT_MEDIA_RECIPE_THRESHOLDS = [
  0.8, 0.9, 0.95, 0.98, 0.99,
] as const;

export interface JevMediaObservation {
  fixtureId: string;
  repetition: number;
  choice: "recipe" | "non_recipe";
  recipeProbability: number;
  nonRecipeProbability: number;
}

export interface RouteMetric {
  expectedFastCaseCount: number;
  expectedFallbackCaseCount: number;
  unsafeFastRouteCaseIds: string[];
  inconsistentFastRouteCaseIds: string[];
  consistentFastRouteCaseIds: string[];
  consistentFastRouteCoverage: number;
  safeFallbackCaseIds: string[];
  safeFallbackCoverage: number;
}

export interface MediaThresholdMetric {
  threshold: number;
  youtube: RouteMetric;
  instagram: RouteMetric;
  tiktok: RouteMetric;
  combinedRouting: RouteMetric;
  aiChat: {
    recipeCaseCount: number;
    nonRecipeCaseCount: number;
    falseClearRecipeCaseIds: string[];
    consistentClearRecipeCaseIds: string[];
    consistentClearRecipeCoverage: number;
  };
}

export interface ClassificationMetric {
  caseCount: number;
  runCount: number;
  correctRunCount: number;
  accuracy: number;
  incorrectCaseIds: string[];
  unstableChoiceCaseIds: string[];
}

export interface MediaRoutingEvaluation {
  completeFixtureCount: number;
  classification: ClassificationMetric;
  classificationByPlatform: {
    youtube: ClassificationMetric;
    instagram: ClassificationMetric;
    tiktok: ClassificationMetric;
    aiChat: ClassificationMetric;
  };
  thresholds: MediaThresholdMetric[];
  candidateRecipeThreshold: number | null;
  candidateThresholdByPlatform: {
    youtube: number | null;
    instagram: number | null;
    tiktok: number | null;
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertProbability(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a finite probability from 0 to 1`);
  }
}

export function youtubeSufficiency(fixture: YoutubeMediaFixture) {
  return assessYoutubeDescription(fixture.description);
}

export function routeForFixture(
  fixture: MediaRoutingFixture,
  recipeProbability: number | null,
  threshold: number,
): MediaExpectedRoute | null {
  assertProbability(threshold, "threshold");
  if (recipeProbability !== null) {
    assertProbability(recipeProbability, "recipeProbability");
  }

  if (fixture.platform === "ai-chat") return null;

  if (fixture.platform === "youtube") {
    if (!fixture.input) return "gemini";
    if (!youtubeSufficiency(fixture).sufficient) return "gemini";
    return recipeProbability !== null && recipeProbability >= threshold
      ? "zai"
      : "gemini";
  }

  if (!fixture.input) return "media";
  return recipeProbability !== null && recipeProbability >= threshold
    ? "text"
    : "media";
}

function isFastRoute(route: MediaExpectedRoute | null): boolean {
  return route === "zai" || route === "text";
}

function observationsForFixture(
  observations: readonly JevMediaObservation[],
  fixtureId: string,
): JevMediaObservation[] {
  return observations
    .filter((observation) => observation.fixtureId === fixtureId)
    .sort((left, right) => left.repetition - right.repetition);
}

function isCompleteFixture(
  fixture: MediaRoutingFixture,
  observations: readonly JevMediaObservation[],
  requiredRepetitions: number,
): boolean {
  if (!fixture.input) return true;
  return (
    observationsForFixture(observations, fixture.id).length >=
    requiredRepetitions
  );
}

function emptyRouteMetric(): RouteMetric {
  return {
    expectedFastCaseCount: 0,
    expectedFallbackCaseCount: 0,
    unsafeFastRouteCaseIds: [],
    inconsistentFastRouteCaseIds: [],
    consistentFastRouteCaseIds: [],
    consistentFastRouteCoverage: 0,
    safeFallbackCaseIds: [],
    safeFallbackCoverage: 0,
  };
}

function evaluateRouteMetric(
  fixtures: readonly MediaRoutingFixture[],
  observations: readonly JevMediaObservation[],
  threshold: number,
): RouteMetric {
  const metric = emptyRouteMetric();

  for (const fixture of fixtures) {
    if (!fixture.expectedRoute) continue;
    const expectedFast = isFastRoute(fixture.expectedRoute);
    if (expectedFast) metric.expectedFastCaseCount += 1;
    else metric.expectedFallbackCaseCount += 1;

    const fixtureObservations = observationsForFixture(
      observations,
      fixture.id,
    );
    const predictedRoutes = fixture.input
      ? fixtureObservations.map((observation) =>
          routeForFixture(fixture, observation.recipeProbability, threshold),
        )
      : [routeForFixture(fixture, null, threshold)];
    const anyFast = predictedRoutes.some(isFastRoute);
    const everyFast =
      predictedRoutes.length > 0 && predictedRoutes.every(isFastRoute);

    if (expectedFast) {
      if (everyFast) metric.consistentFastRouteCaseIds.push(fixture.id);
      else metric.inconsistentFastRouteCaseIds.push(fixture.id);
    } else if (anyFast) {
      metric.unsafeFastRouteCaseIds.push(fixture.id);
    } else {
      metric.safeFallbackCaseIds.push(fixture.id);
    }
  }

  metric.consistentFastRouteCoverage = ratio(
    metric.consistentFastRouteCaseIds.length,
    metric.expectedFastCaseCount,
  );
  metric.safeFallbackCoverage = ratio(
    metric.safeFallbackCaseIds.length,
    metric.expectedFallbackCaseCount,
  );
  return metric;
}

function candidateThreshold(
  metrics: readonly MediaThresholdMetric[],
  platform: "youtube" | "instagram" | "tiktok" | "combinedRouting",
): number | null {
  return (
    metrics.find((metric) => {
      const routeMetric = metric[platform];
      return (
        routeMetric.unsafeFastRouteCaseIds.length === 0 &&
        routeMetric.consistentFastRouteCaseIds.length > 0
      );
    })?.threshold ?? null
  );
}

function evaluateClassificationMetric(
  fixtures: readonly MediaRoutingFixture[],
  observations: readonly JevMediaObservation[],
  requiredRepetitions: number,
): ClassificationMetric {
  let correctRunCount = 0;
  const incorrectCaseIds = new Set<string>();
  const unstableChoiceCaseIds: string[] = [];
  let runCount = 0;

  for (const fixture of fixtures) {
    if (!fixture.input || fixture.expectedKind === null) continue;
    const runs = observationsForFixture(observations, fixture.id).slice(
      0,
      requiredRepetitions,
    );
    runCount += runs.length;
    const choices = new Set(runs.map(({ choice }) => choice));
    if (choices.size > 1) unstableChoiceCaseIds.push(fixture.id);
    for (const run of runs) {
      const expectedChoice =
        fixture.expectedKind === "recipe" ? "recipe" : "non_recipe";
      if (run.choice === expectedChoice) correctRunCount += 1;
      else incorrectCaseIds.add(fixture.id);
    }
  }

  return {
    caseCount: fixtures.filter(
      (fixture) => fixture.input && fixture.expectedKind !== null,
    ).length,
    runCount,
    correctRunCount,
    accuracy: ratio(correctRunCount, runCount),
    incorrectCaseIds: [...incorrectCaseIds].sort(),
    unstableChoiceCaseIds: unstableChoiceCaseIds.sort(),
  };
}

export function evaluateMediaRouting(
  fixtures: readonly MediaRoutingFixture[],
  observations: readonly JevMediaObservation[],
  requiredRepetitions: number,
  thresholds: readonly number[] = DEFAULT_MEDIA_RECIPE_THRESHOLDS,
): MediaRoutingEvaluation {
  if (!Number.isInteger(requiredRepetitions) || requiredRepetitions < 1) {
    throw new Error("requiredRepetitions must be a positive integer");
  }
  for (const threshold of thresholds) {
    assertProbability(threshold, "threshold");
  }
  for (const observation of observations) {
    assertProbability(observation.recipeProbability, "recipeProbability");
    assertProbability(
      observation.nonRecipeProbability,
      "nonRecipeProbability",
    );
  }

  const completeFixtures = fixtures.filter((fixture) =>
    isCompleteFixture(fixture, observations, requiredRepetitions),
  );
  const classifiedFixtures = completeFixtures.filter(
    (fixture) => fixture.input && fixture.expectedKind !== null,
  );
  const classifiedFixtureIds = new Set(
    classifiedFixtures.map(({ id }) => id),
  );
  const completeObservations = observations.filter((observation) =>
    classifiedFixtureIds.has(observation.fixtureId),
  );

  const thresholdsResult = thresholds.map((threshold) => {
    const youtubeFixtures = completeFixtures.filter(
      ({ platform }) => platform === "youtube",
    );
    const instagramFixtures = completeFixtures.filter(
      ({ platform }) => platform === "instagram",
    );
    const tiktokFixtures = completeFixtures.filter(
      ({ platform }) => platform === "tiktok",
    );
    const routingFixtures = completeFixtures.filter(
      ({ platform }) => platform !== "ai-chat",
    );
    const aiFixtures = completeFixtures.filter(
      ({ platform, expectedKind }) =>
        platform === "ai-chat" && expectedKind !== null,
    );

    const recipeAiFixtures = aiFixtures.filter(
      ({ expectedKind }) => expectedKind === "recipe",
    );
    const nonRecipeAiFixtures = aiFixtures.filter(
      ({ expectedKind }) => expectedKind === "non-recipe",
    );
    const falseClearRecipeCaseIds = nonRecipeAiFixtures
      .filter((fixture) =>
        observationsForFixture(completeObservations, fixture.id)
          .slice(0, requiredRepetitions)
          .some(({ recipeProbability }) => recipeProbability >= threshold),
      )
      .map(({ id }) => id);
    const consistentClearRecipeCaseIds = recipeAiFixtures
      .filter((fixture) => {
        const runs = observationsForFixture(
          completeObservations,
          fixture.id,
        ).slice(0, requiredRepetitions);
        return (
          runs.length === requiredRepetitions &&
          runs.every(
            ({ recipeProbability }) => recipeProbability >= threshold,
          )
        );
      })
      .map(({ id }) => id);

    return {
      threshold,
      youtube: evaluateRouteMetric(
        youtubeFixtures,
        completeObservations,
        threshold,
      ),
      instagram: evaluateRouteMetric(
        instagramFixtures,
        completeObservations,
        threshold,
      ),
      tiktok: evaluateRouteMetric(
        tiktokFixtures,
        completeObservations,
        threshold,
      ),
      combinedRouting: evaluateRouteMetric(
        routingFixtures,
        completeObservations,
        threshold,
      ),
      aiChat: {
        recipeCaseCount: recipeAiFixtures.length,
        nonRecipeCaseCount: nonRecipeAiFixtures.length,
        falseClearRecipeCaseIds,
        consistentClearRecipeCaseIds,
        consistentClearRecipeCoverage: ratio(
          consistentClearRecipeCaseIds.length,
          recipeAiFixtures.length,
        ),
      },
    };
  });

  return {
    completeFixtureCount: completeFixtures.length,
    classification: evaluateClassificationMetric(
      classifiedFixtures,
      completeObservations,
      requiredRepetitions,
    ),
    classificationByPlatform: {
      youtube: evaluateClassificationMetric(
        classifiedFixtures.filter(({ platform }) => platform === "youtube"),
        completeObservations,
        requiredRepetitions,
      ),
      instagram: evaluateClassificationMetric(
        classifiedFixtures.filter(({ platform }) => platform === "instagram"),
        completeObservations,
        requiredRepetitions,
      ),
      tiktok: evaluateClassificationMetric(
        classifiedFixtures.filter(({ platform }) => platform === "tiktok"),
        completeObservations,
        requiredRepetitions,
      ),
      aiChat: evaluateClassificationMetric(
        classifiedFixtures.filter(({ platform }) => platform === "ai-chat"),
        completeObservations,
        requiredRepetitions,
      ),
    },
    thresholds: thresholdsResult,
    candidateRecipeThreshold: candidateThreshold(
      thresholdsResult,
      "combinedRouting",
    ),
    candidateThresholdByPlatform: {
      youtube: candidateThreshold(thresholdsResult, "youtube"),
      instagram: candidateThreshold(thresholdsResult, "instagram"),
      tiktok: candidateThreshold(thresholdsResult, "tiktok"),
    },
  };
}
