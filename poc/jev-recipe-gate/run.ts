import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TARGET_PER_KIND,
  evaluateCorpusQuality,
  MIN_HARD_NEGATIVE_COUNT,
  siteCapForTarget,
} from "./corpus-policy.js";
import {
  discoverJevGateCases,
  isKnownRecipeUrl,
  type DiscoveredCase,
} from "./discovery.js";
import { extractUrl } from "../url-extraction/extract.js";
import {
  classifyRecipeContent,
  DEFAULT_JEV_MODEL,
  JEV_INPUT_USD_PER_MILLION,
  type JevRecipeClassification,
} from "./jev.js";
import {
  DEFAULT_REJECT_THRESHOLDS,
  evaluateThresholds,
  type JevGateObservation,
} from "./metrics.js";

const DEFAULT_REPETITIONS = 3;
const MAX_REPETITIONS = 10;
const MIN_INPUT_CHARS = 100;
const root = process.cwd();
const resultsDirectory = path.join(root, "poc/results");
const outputPath = path.join(
  resultsDirectory,
  "jev-recipe-gate-results.json",
);

interface ExtractionSummary {
  ok: boolean;
  httpStatus: number;
  finalUrl: string;
  methods: string[];
  textLength: number;
  textSha256: string;
  hasRecipeSignals: boolean;
  jsonLdRecipeCount: number;
}

interface ValidatedCase {
  fixture: DiscoveredCase;
  extraction: ExtractionSummary;
  pageContent: string;
}

interface CaseRun extends JevRecipeClassification {
  repetition: number;
}

interface CaseResult {
  id: string;
  source: DiscoveredCase["source"];
  sourceUrl: string;
  expected: DiscoveredCase["kind"];
  discoverySite: string;
  negativeTier: DiscoveredCase["negativeTier"];
  extraction: ExtractionSummary;
  runs: CaseRun[];
  error: string | null;
}

function parseRepetitions(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_REPETITIONS);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_REPETITIONS
  ) {
    throw new Error(
      `JEV_POC_REPETITIONS must be an integer from 1 to ${MAX_REPETITIONS}`,
    );
  }
  return parsed;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function runSummary(runs: CaseRun[]) {
  const nonRecipeProbabilities = runs.map(
    ({ nonRecipeProbability }) => nonRecipeProbability,
  );
  const confidences = runs.map(({ confidence }) => confidence);
  return {
    runCount: runs.length,
    nonRecipeProbability: {
      min:
        nonRecipeProbabilities.length > 0
          ? Math.min(...nonRecipeProbabilities)
          : null,
      max:
        nonRecipeProbabilities.length > 0
          ? Math.max(...nonRecipeProbabilities)
          : null,
      average: average(nonRecipeProbabilities),
    },
    confidence: {
      min: confidences.length > 0 ? Math.min(...confidences) : null,
      max: confidences.length > 0 ? Math.max(...confidences) : null,
      average: average(confidences),
    },
  };
}

function canUseSite(
  fixture: DiscoveredCase,
  siteCounts: Map<string, number>,
  perSiteCap: number,
): boolean {
  return (siteCounts.get(fixture.discoverySite) ?? 0) < perSiteCap;
}

async function validateCandidate(
  fixture: DiscoveredCase,
): Promise<ValidatedCase | null> {
  const extraction = await extractUrl(fixture);
  const pageContent = extraction.aiInput.text.trim();
  if (!extraction.http.ok || pageContent.length < MIN_INPUT_CHARS) return null;

  if (
    fixture.kind === "recipe" &&
    (!extraction.evidence.hasRecipeSignals ||
      !isKnownRecipeUrl(extraction.finalUrl))
  ) {
    return null;
  }
  if (
    fixture.kind === "non-recipe" &&
    (extraction.jsonLdRecipes.length > 0 ||
      isKnownRecipeUrl(extraction.finalUrl))
  ) {
    return null;
  }

  return {
    fixture,
    pageContent,
    extraction: {
      ok: true,
      httpStatus: extraction.http.status,
      finalUrl: extraction.finalUrl,
      methods: extraction.evidence.extractionMethods,
      textLength: pageContent.length,
      textSha256: createHash("sha256").update(pageContent).digest("hex"),
      hasRecipeSignals: extraction.evidence.hasRecipeSignals,
      jsonLdRecipeCount: extraction.jsonLdRecipes.length,
    },
  };
}

async function validateCases(
  candidates: DiscoveredCase[],
  target: number,
  siteCounts: Map<string, number>,
  selected: ValidatedCase[],
  perSiteCap: number,
  seenFinalUrls: Set<string>,
  seenTextHashes: Set<string>,
): Promise<void> {
  for (const fixture of candidates) {
    if (selected.length >= target) return;
    if (!canUseSite(fixture, siteCounts, perSiteCap)) continue;

    process.stdout.write(
      `validate ${fixture.kind} ${fixture.discoverySite} ${fixture.id} ... `,
    );
    const validated = await validateCandidate(fixture);
    if (!validated) {
      console.log("skip");
      continue;
    }

    if (
      seenFinalUrls.has(validated.extraction.finalUrl) ||
      seenTextHashes.has(validated.extraction.textSha256)
    ) {
      console.log("skip duplicate content");
      continue;
    }

    seenFinalUrls.add(validated.extraction.finalUrl);
    seenTextHashes.add(validated.extraction.textSha256);
    selected.push(validated);
    siteCounts.set(
      fixture.discoverySite,
      (siteCounts.get(fixture.discoverySite) ?? 0) + 1,
    );
    console.log(
      `ok chars=${validated.pageContent.length} selected=${selected.length}/${target}`,
    );
  }
}

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "TYPESAFE_API_KEY is required before running the Jev recipe gate PoC",
  );
}

const repetitions = parseRepetitions(process.env.JEV_POC_REPETITIONS);
const model = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
const targetPerKind = DEFAULT_TARGET_PER_KIND;
const perSiteCap = siteCapForTarget(targetPerKind);

console.log(
  `discovering corpus: target recipe=${targetPerKind}, non-recipe=${targetPerKind}, hard-negative minimum=${MIN_HARD_NEGATIVE_COUNT}, per-site cap=${perSiteCap}`,
);
const discovered = await discoverJevGateCases();
console.log(
  `discovered candidates: recipe=${discovered.recipe.length}, hard-negative=${discovered.hardNegative.length}, easy-negative=${discovered.easyNegative.length}`,
);

const seenFinalUrls = new Set<string>();
const seenTextHashes = new Set<string>();
const recipeCases: ValidatedCase[] = [];
const recipeSiteCounts = new Map<string, number>();
await validateCases(
  discovered.recipe,
  targetPerKind,
  recipeSiteCounts,
  recipeCases,
  perSiteCap,
  seenFinalUrls,
  seenTextHashes,
);

const nonRecipeCases: ValidatedCase[] = [];
const nonRecipeSiteCounts = new Map<string, number>();
await validateCases(
  discovered.hardNegative,
  targetPerKind,
  nonRecipeSiteCounts,
  nonRecipeCases,
  perSiteCap,
  seenFinalUrls,
  seenTextHashes,
);
if (nonRecipeCases.length < targetPerKind) {
  await validateCases(
    discovered.easyNegative,
    targetPerKind,
    nonRecipeSiteCounts,
    nonRecipeCases,
    perSiteCap,
    seenFinalUrls,
    seenTextHashes,
  );
}

const corpus = [...recipeCases, ...nonRecipeCases];
const corpusQuality = evaluateCorpusQuality(
  corpus.map(({ fixture }) => fixture),
  targetPerKind,
);

if (!corpusQuality.meetsDefaultTarget) {
  await fs.mkdir(resultsDirectory, { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        purpose:
          "Evaluate whether Jev can safely reject clearly non-recipe HTML-derived content before the existing recipe extraction pipeline.",
        technicalComplete: false,
        phase: "corpus-validation",
        corpusQuality,
        discoveredCandidateCounts: {
          recipe: discovered.recipe.length,
          hardNegative: discovered.hardNegative.length,
          easyNegative: discovered.easyNegative.length,
        },
        validatedCorpus: corpus.map(({ fixture, extraction }) => ({
          ...fixture,
          extraction,
        })),
      },
      null,
      2,
    )}\n`,
  );
  throw new Error(
    `Jev PoC corpus does not meet the required 300/300 quality gate; recipe=${corpusQuality.recipeCount}, non-recipe=${corpusQuality.nonRecipeCount}, hard-negative=${corpusQuality.hardNegativeCount}`,
  );
}

console.log(
  `corpus ready: recipe=${corpusQuality.recipeCount}, non-recipe=${corpusQuality.nonRecipeCount}, hard-negative=${corpusQuality.hardNegativeCount}, zero-error 95% upper bound=${(corpusQuality.zeroRecipeFalseRejectUpperBound95 * 100).toFixed(2)}%`,
);

const observations: JevGateObservation[] = [];
const results: CaseResult[] = [];
let totalEstimatedCostUsd = 0;

for (const validated of corpus) {
  const { fixture, extraction, pageContent } = validated;
  const runs: CaseRun[] = [];
  let caseError: string | null = null;

  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    process.stdout.write(
      `Jev ${repetition}/${repetitions} ${fixture.kind} ${fixture.id} ... `,
    );
    try {
      const classification = await classifyRecipeContent(pageContent, {
        apiKey,
        model,
      });
      const run = { repetition, ...classification };
      runs.push(run);
      observations.push({
        id: fixture.id,
        expected: fixture.kind,
        repetition,
        nonRecipeProbability: classification.nonRecipeProbability,
      });
      totalEstimatedCostUsd += classification.estimatedCostUsd;
      console.log(
        `${classification.choice} p(non_recipe)=${classification.nonRecipeProbability.toFixed(4)} confidence=${classification.confidence.toFixed(4)} ${classification.elapsedMs}ms`,
      );
    } catch (error) {
      caseError = error instanceof Error ? error.message : String(error);
      console.log(`ERROR ${caseError}`);
      break;
    }
  }

  results.push({
    id: fixture.id,
    source: fixture.source,
    sourceUrl: fixture.url,
    expected: fixture.kind,
    discoverySite: fixture.discoverySite,
    negativeTier: fixture.negativeTier,
    extraction,
    runs,
    error: caseError,
  });
}

const thresholdEvaluation = evaluateThresholds(
  observations,
  DEFAULT_REJECT_THRESHOLDS,
);
const incompleteCaseIds = results
  .filter(({ runs }) => runs.length !== repetitions)
  .map(({ id }) => id);
const technicalComplete = incompleteCaseIds.length === 0;
const qualifiedCandidateThreshold = technicalComplete
  ? thresholdEvaluation.fixtureSafeCandidateThreshold
  : null;

const payload = {
  generatedAt: new Date().toISOString(),
  purpose:
    "Evaluate whether Jev can safely reject clearly non-recipe HTML-derived content before the existing recipe extraction pipeline.",
  modelRequested: model,
  repetitions,
  minimumInputCharacters: MIN_INPUT_CHARS,
  corpusPolicy: {
    targetPerKind,
    minimumHardNegativeCount: MIN_HARD_NEGATIVE_COUNT,
    perSiteCap,
  },
  corpusQuality,
  pricing: {
    inputUsdPerMillionTokens: JEV_INPUT_USD_PER_MILLION,
    outputUsdPerMillionTokens: 0,
    totalEstimatedCostUsd,
  },
  rejectionRule:
    "Reject only when probabilities.non_recipe is greater than or equal to the selected threshold. Jev confidence is recorded separately and is not used as the rejection threshold.",
  thresholds: [...DEFAULT_REJECT_THRESHOLDS],
  fixtureCount: corpus.length,
  technicalComplete,
  incompleteCaseIds,
  thresholdEvaluation,
  qualifiedCandidateThreshold,
  statisticalInterpretation:
    "With 300 distinct recipe URLs and zero false rejects, the exact one-sided 95% upper bound for the underlying false-reject probability is approximately 1%. Repeated calls measure model stability but do not replace content diversity.",
  cases: results.map((result) => ({
    ...result,
    summary: runSummary(result.runs),
  })),
};

await fs.mkdir(resultsDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(
  `\ncompleted: ${results.length} distinct URLs x ${repetitions} planned repetitions`,
);
console.log(
  `estimated Jev cost: $${totalEstimatedCostUsd.toFixed(6)}; results: ${path.relative(root, outputPath)}`,
);
if (qualifiedCandidateThreshold === null) {
  console.log(
    technicalComplete
      ? "fixture-safe candidate threshold: none (do not enable hard rejection)"
      : "fixture-safe candidate threshold: unavailable because the run is incomplete",
  );
} else {
  console.log(
    `fixture-safe candidate threshold: ${qualifiedCandidateThreshold.toFixed(2)} (fixture-only; not production approval)`,
  );
}

if (!technicalComplete) {
  console.error(
    `PoC incomplete: ${incompleteCaseIds.length} case(s) did not finish all repetitions`,
  );
  process.exitCode = 1;
}
