import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import cases from "./cases.json" with { type: "json" };
import { extractUrl } from "../url-extraction/extract.js";
import type { UrlCase } from "../url-extraction/types.js";
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

interface CaseRun extends JevRecipeClassification {
  repetition: number;
}

interface CaseResult {
  id: string;
  source: UrlCase["source"];
  sourceUrl: string;
  expected: UrlCase["kind"];
  extraction: {
    ok: boolean;
    httpStatus: number;
    finalUrl: string;
    methods: string[];
    textLength: number;
    textSha256: string;
  };
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

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "TYPESAFE_API_KEY is required before running the Jev recipe gate PoC",
  );
}

const repetitions = parseRepetitions(process.env.JEV_POC_REPETITIONS);
const model = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
const urlCases = cases as UrlCase[];
const observations: JevGateObservation[] = [];
const results: CaseResult[] = [];
let totalEstimatedCostUsd = 0;

await fs.mkdir(resultsDirectory, { recursive: true });

for (const testCase of urlCases) {
  process.stdout.write(`extract ${testCase.id} ... `);
  const extraction = await extractUrl(testCase);
  const pageContent = extraction.aiInput.text.trim();
  const textSha256 = createHash("sha256").update(pageContent).digest("hex");
  const extractionSummary = {
    ok: extraction.http.ok && pageContent.length >= MIN_INPUT_CHARS,
    httpStatus: extraction.http.status,
    finalUrl: extraction.finalUrl,
    methods: extraction.evidence.extractionMethods,
    textLength: pageContent.length,
    textSha256,
  };

  if (!extractionSummary.ok) {
    const error = !extraction.http.ok
      ? extraction.error ?? `HTTP ${extraction.http.status}`
      : `extracted input shorter than ${MIN_INPUT_CHARS} characters`;
    results.push({
      id: testCase.id,
      source: testCase.source,
      sourceUrl: testCase.url,
      expected: testCase.kind,
      extraction: extractionSummary,
      runs: [],
      error,
    });
    console.log(`SKIP ${error}`);
    continue;
  }
  console.log(
    `ok chars=${pageContent.length} methods=${extractionSummary.methods.join(",")}`,
  );

  const runs: CaseRun[] = [];
  let caseError: string | null = null;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    process.stdout.write(
      `  Jev ${repetition}/${repetitions} ${testCase.id} ... `,
    );
    try {
      const classification = await classifyRecipeContent(pageContent, {
        apiKey,
        model,
      });
      const run = { repetition, ...classification };
      runs.push(run);
      observations.push({
        id: testCase.id,
        expected: testCase.kind,
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
    id: testCase.id,
    source: testCase.source,
    sourceUrl: testCase.url,
    expected: testCase.kind,
    extraction: extractionSummary,
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

const payload = {
  generatedAt: new Date().toISOString(),
  purpose:
    "Evaluate whether Jev can safely reject clearly non-recipe HTML-derived content before the existing recipe extraction pipeline.",
  modelRequested: model,
  repetitions,
  minimumInputCharacters: MIN_INPUT_CHARS,
  pricing: {
    inputUsdPerMillionTokens: JEV_INPUT_USD_PER_MILLION,
    outputUsdPerMillionTokens: 0,
    totalEstimatedCostUsd,
  },
  rejectionRule:
    "Reject only when probabilities.non_recipe is greater than or equal to the selected threshold. Jev confidence is recorded separately and is not used as the rejection threshold.",
  thresholds: [...DEFAULT_REJECT_THRESHOLDS],
  fixtureCount: urlCases.length,
  technicalComplete: incompleteCaseIds.length === 0,
  incompleteCaseIds,
  thresholdEvaluation,
  cases: results.map((result) => ({
    ...result,
    summary: runSummary(result.runs),
  })),
};

await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(
  `\ncompleted: ${results.length} cases x ${repetitions} planned repetitions`,
);
console.log(
  `estimated Jev cost: $${totalEstimatedCostUsd.toFixed(6)}; results: ${path.relative(root, outputPath)}`,
);
if (thresholdEvaluation.fixtureSafeCandidateThreshold === null) {
  console.log(
    "fixture-safe candidate threshold: none (do not enable hard rejection from this fixture set)",
  );
} else {
  console.log(
    `fixture-safe candidate threshold: ${thresholdEvaluation.fixtureSafeCandidateThreshold.toFixed(2)} (fixture-only; not production approval)`,
  );
}

if (incompleteCaseIds.length > 0) {
  console.error(
    `PoC incomplete: ${incompleteCaseIds.length} case(s) did not finish all repetitions`,
  );
  process.exitCode = 1;
}
