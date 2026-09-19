import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  parseBatchSize,
  selectBatchCaseIds,
} from "./batch.js";
import {
  DEFAULT_TARGET_PER_KIND,
  evaluateCorpusQuality,
  MIN_HARD_NEGATIVE_COUNT,
  siteCapForTarget,
  type CorpusQuality,
} from "./corpus-policy.js";
import {
  classifyKnownUrl,
  discoverJevGateCases,
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

const STATE_SCHEMA_VERSION = 2;
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
  extraction: ExtractionSummary | null;
  runs: CaseRun[];
  error: string | null;
}

interface BatchRecord {
  startedAt: string;
  completedAt: string | null;
  selectedCaseIds: string[];
  processedCaseIds: string[];
  successfulClassifications: number;
  httpAttempts: number;
  estimatedCostUsd: number;
  error: string | null;
  retryCaseId: string | null;
  stopReason: "batch-limit" | "api-error" | "no-pending-cases" | null;
}

interface ResultState {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  purpose: string;
  phase: "discovering" | "batch-evaluation" | "complete";
  modelRequested: string;
  repetitions: number;
  batchSize: number;
  minimumInputCharacters: number;
  corpusPolicy: {
    targetPerKind: number;
    minimumHardNegativeCount: number;
    perSiteCap: number;
  };
  discoveredCandidateCounts: {
    recipe: number;
    hardNegative: number;
    easyNegative: number;
  } | null;
  corpusQuality: CorpusQuality | null;
  corpusComplete: boolean;
  technicalComplete: boolean;
  pricing: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    totalEstimatedCostUsd: number;
  };
  rejectionRule: string;
  thresholds: number[];
  fixtureCount: number;
  completedCaseCount: number;
  pendingCaseCount: number;
  failedCaseCount: number;
  thresholdEvaluation: ReturnType<typeof evaluateThresholds>;
  provisionalCandidateThreshold: number | null;
  qualifiedCandidateThreshold: number | null;
  statisticalInterpretation: string;
  lastBatch: BatchRecord | null;
  cases: CaseResult[];
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

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
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

  const finalClassification = classifyKnownUrl(extraction.finalUrl);
  if (
    fixture.kind === "recipe" &&
    (!extraction.evidence.hasRecipeSignals ||
      finalClassification?.kind !== "recipe")
  ) {
    return null;
  }
  if (
    fixture.kind === "non-recipe" &&
    (extraction.jsonLdRecipes.length > 0 ||
      finalClassification?.kind !== "non-recipe")
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

    let validated: ValidatedCase | null = null;
    try {
      validated = await validateCandidate(fixture);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`skip error=${message}`);
      continue;
    }

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

function observationsFromCompletedCases(
  cases: CaseResult[],
  repetitions: number,
): JevGateObservation[] {
  return cases
    .filter(({ runs, error }) => error === null && runs.length >= repetitions)
    .flatMap((item) =>
      item.runs.slice(0, repetitions).map((run) => ({
        id: item.id,
        expected: item.expected,
        repetition: run.repetition,
        nonRecipeProbability: run.nonRecipeProbability,
      })),
    );
}

function updateDerivedState(state: ResultState): void {
  const completedCases = state.cases.filter(
    ({ runs, error }) => error === null && runs.length >= state.repetitions,
  );
  const failedCases = state.cases.filter(({ error }) => error !== null);
  const pendingCases = state.cases.filter(
    ({ runs, error }) => error === null && runs.length < state.repetitions,
  );
  const thresholdEvaluation = evaluateThresholds(
    observationsFromCompletedCases(state.cases, state.repetitions),
    state.thresholds,
  );
  const totalEstimatedCostUsd = state.cases.reduce(
    (caseTotal, item) =>
      caseTotal +
      item.runs.reduce(
        (runTotal, run) => runTotal + run.estimatedCostUsd,
        0,
      ),
    0,
  );

  state.fixtureCount = state.cases.length;
  state.completedCaseCount = completedCases.length;
  state.pendingCaseCount = pendingCases.length;
  state.failedCaseCount = failedCases.length;
  state.thresholdEvaluation = thresholdEvaluation;
  state.provisionalCandidateThreshold =
    thresholdEvaluation.fixtureSafeCandidateThreshold;
  state.technicalComplete =
    state.corpusComplete &&
    state.cases.length > 0 &&
    completedCases.length === state.cases.length &&
    failedCases.length === 0;
  state.qualifiedCandidateThreshold = state.technicalComplete
    ? thresholdEvaluation.fixtureSafeCandidateThreshold
    : null;
  state.pricing.totalEstimatedCostUsd = totalEstimatedCostUsd;
  state.phase =
    state.corpusQuality === null
      ? "discovering"
      : state.technicalComplete
        ? "complete"
        : "batch-evaluation";
  state.updatedAt = new Date().toISOString();
}

function serializedState(state: ResultState): string {
  return `${JSON.stringify(
    {
      ...state,
      cases: state.cases.map((item) => ({
        ...item,
        summary: runSummary(item.runs),
      })),
    },
    null,
    2,
  )}\n`;
}

async function writeState(state: ResultState): Promise<void> {
  updateDerivedState(state);
  await fs.mkdir(resultsDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, serializedState(state), "utf8");
  await fs.rename(temporaryPath, outputPath);
}

async function readState(): Promise<ResultState | null> {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ResultState>;
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new Error(
        `Existing Jev result state uses an unsupported schema. Run with JEV_POC_RESET=1 to rebuild ${path.relative(root, outputPath)}.`,
      );
    }
    return parsed as ResultState;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function emptyState(
  model: string,
  repetitions: number,
  batchSize: number,
  targetPerKind: number,
  perSiteCap: number,
): ResultState {
  const now = new Date().toISOString();
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    purpose:
      "Evaluate whether Jev can safely reject clearly non-recipe HTML-derived content before the existing recipe extraction pipeline.",
    phase: "discovering",
    modelRequested: model,
    repetitions,
    batchSize,
    minimumInputCharacters: MIN_INPUT_CHARS,
    corpusPolicy: {
      targetPerKind,
      minimumHardNegativeCount: MIN_HARD_NEGATIVE_COUNT,
      perSiteCap,
    },
    discoveredCandidateCounts: null,
    corpusQuality: null,
    corpusComplete: false,
    technicalComplete: false,
    pricing: {
      inputUsdPerMillionTokens: JEV_INPUT_USD_PER_MILLION,
      outputUsdPerMillionTokens: 0,
      totalEstimatedCostUsd: 0,
    },
    rejectionRule:
      "Reject only when probabilities.non_recipe is greater than or equal to the selected threshold. Jev confidence is recorded separately and is not used as the rejection threshold.",
    thresholds: [...DEFAULT_REJECT_THRESHOLDS],
    fixtureCount: 0,
    completedCaseCount: 0,
    pendingCaseCount: 0,
    failedCaseCount: 0,
    thresholdEvaluation: evaluateThresholds([], DEFAULT_REJECT_THRESHOLDS),
    provisionalCandidateThreshold: null,
    qualifiedCandidateThreshold: null,
    statisticalInterpretation:
      "A full 500-recipe corpus with zero false rejects has an exact one-sided 95% binomial upper bound of approximately 0.6%. Partial batches are useful evidence but cannot qualify a production hard-reject threshold.",
    lastBatch: null,
    cases: [],
  };
}

function storedCaseFromValidated(validated: ValidatedCase): CaseResult {
  return {
    id: validated.fixture.id,
    source: validated.fixture.source,
    sourceUrl: validated.fixture.url,
    expected: validated.fixture.kind,
    discoverySite: validated.fixture.discoverySite,
    negativeTier: validated.fixture.negativeTier,
    extraction: validated.extraction,
    runs: [],
    error: null,
  };
}

function fixtureFromStored(item: CaseResult): DiscoveredCase {
  return {
    id: item.id,
    source: item.source,
    url: item.sourceUrl,
    kind: item.expected,
    discoverySite: item.discoverySite,
    negativeTier: item.negativeTier,
  };
}

function mergePreviousRuns(
  cases: CaseResult[],
  previous: ResultState | null,
): void {
  if (!previous) return;
  const previousById = new Map(previous.cases.map((item) => [item.id, item]));

  for (const item of cases) {
    const old = previousById.get(item.id);
    if (
      !old ||
      old.sourceUrl !== item.sourceUrl ||
      old.expected !== item.expected
    ) {
      continue;
    }
    if (
      old.extraction?.textSha256 === item.extraction?.textSha256
    ) {
      item.runs = old.runs;
    }
    item.error = null;
  }
}

async function discoverCorpus(
  state: ResultState,
  previous: ResultState | null,
): Promise<Map<string, ValidatedCase>> {
  console.log(
    `discovering corpus: target recipe=${state.corpusPolicy.targetPerKind}, non-recipe=${state.corpusPolicy.targetPerKind}, hard-negative target=${state.corpusPolicy.minimumHardNegativeCount}, per-site cap=${state.corpusPolicy.perSiteCap}`,
  );

  const discovered = await discoverJevGateCases();
  state.discoveredCandidateCounts = {
    recipe: discovered.recipe.length,
    hardNegative: discovered.hardNegative.length,
    easyNegative: discovered.easyNegative.length,
  };
  await writeState(state);

  console.log(
    `discovered candidates: recipe=${discovered.recipe.length}, hard-negative=${discovered.hardNegative.length}, easy-negative=${discovered.easyNegative.length}`,
  );

  const seenFinalUrls = new Set<string>();
  const seenTextHashes = new Set<string>();
  const recipeCases: ValidatedCase[] = [];
  const recipeSiteCounts = new Map<string, number>();
  await validateCases(
    discovered.recipe,
    state.corpusPolicy.targetPerKind,
    recipeSiteCounts,
    recipeCases,
    state.corpusPolicy.perSiteCap,
    seenFinalUrls,
    seenTextHashes,
  );

  const nonRecipeCases: ValidatedCase[] = [];
  const nonRecipeSiteCounts = new Map<string, number>();
  await validateCases(
    discovered.hardNegative,
    state.corpusPolicy.targetPerKind,
    nonRecipeSiteCounts,
    nonRecipeCases,
    state.corpusPolicy.perSiteCap,
    seenFinalUrls,
    seenTextHashes,
  );
  if (nonRecipeCases.length < state.corpusPolicy.targetPerKind) {
    await validateCases(
      discovered.easyNegative,
      state.corpusPolicy.targetPerKind,
      nonRecipeSiteCounts,
      nonRecipeCases,
      state.corpusPolicy.perSiteCap,
      seenFinalUrls,
      seenTextHashes,
    );
  }

  const validated = [...recipeCases, ...nonRecipeCases];
  state.cases = validated.map(storedCaseFromValidated);
  mergePreviousRuns(state.cases, previous);
  state.corpusQuality = evaluateCorpusQuality(
    validated.map(({ fixture }) => fixture),
    state.corpusPolicy.targetPerKind,
  );
  state.corpusComplete = state.corpusQuality.meetsDefaultTarget;
  await writeState(state);

  console.log(
    `validated corpus: recipe=${state.corpusQuality.recipeCount}, non-recipe=${state.corpusQuality.nonRecipeCount}, hard-negative=${state.corpusQuality.hardNegativeCount}, full-quality-gate=${state.corpusComplete ? "pass" : "not yet"}`,
  );
  if (!state.corpusComplete) {
    console.log(
      "Corpus is below the final 500/500 quality gate. Batch evaluation may continue, but no production-qualified threshold will be emitted.",
    );
  }

  return new Map(validated.map((item) => [item.fixture.id, item]));
}

function assertCompatibleState(
  state: ResultState,
  model: string,
  repetitions: number,
): void {
  if (state.modelRequested !== model || state.repetitions !== repetitions) {
    throw new Error(
      `Existing result state uses model=${state.modelRequested}, repetitions=${state.repetitions}. Current run requested model=${model}, repetitions=${repetitions}. Use the same settings or run JEV_POC_RESET=1 npm run poc:jev-gate.`,
    );
  }
}

const model = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
const repetitions = parseRepetitions(process.env.JEV_POC_REPETITIONS);
const batchSize = parseBatchSize(process.env.JEV_POC_BATCH_SIZE);
const targetPerKind = DEFAULT_TARGET_PER_KIND;
const perSiteCap = siteCapForTarget(targetPerKind);
const reset = envFlag(process.env.JEV_POC_RESET);
const refreshCorpus = envFlag(process.env.JEV_POC_REFRESH_CORPUS);

if (reset) {
  await fs.rm(outputPath, { force: true });
}

let state = await readState();
if (state) {
  assertCompatibleState(state, model, repetitions);
}

let preparedCases = new Map<string, ValidatedCase>();
if (!state || refreshCorpus || state.corpusQuality === null) {
  const previous = state;
  state = emptyState(
    model,
    repetitions,
    batchSize,
    targetPerKind,
    perSiteCap,
  );
  await writeState(state);
  console.log(
    `checkpoint created: ${path.relative(root, outputPath)}`,
  );
  preparedCases = await discoverCorpus(state, previous);
} else {
  state.batchSize = batchSize;
  await writeState(state);
  console.log(
    `resuming: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}, failed=${state.failedCaseCount}, total=${state.fixtureCount}`,
  );
}

const retryCaseId =
  state.lastBatch?.stopReason === "api-error"
    ? state.lastBatch.retryCaseId
    : null;
const selectedCaseIds = selectBatchCaseIds(
  state.cases.map((item) => ({
    id: item.id,
    expected: item.expected,
    completedRuns: item.runs.length,
    hasTerminalError: item.error !== null,
    retryPriority: item.id === retryCaseId,
  })),
  state.repetitions,
  batchSize,
);

if (selectedCaseIds.length === 0) {
  state.lastBatch = {
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    selectedCaseIds: [],
    processedCaseIds: [],
    successfulClassifications: 0,
    httpAttempts: 0,
    estimatedCostUsd: 0,
    error: null,
    retryCaseId: null,
    stopReason: "no-pending-cases",
  };
  await writeState(state);

  console.log(
    `No pending cases. results: ${path.relative(root, outputPath)}`,
  );
  if (!state.technicalComplete) {
    console.log(
      "All currently validated cases are exhausted, but the final corpus/evidence gate is incomplete. Improve discovery and rerun with JEV_POC_REFRESH_CORPUS=1.",
    );
  }
  process.exit(0);
}

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "TYPESAFE_API_KEY is required before running a Jev evaluation batch",
  );
}

const batch: BatchRecord = {
  startedAt: new Date().toISOString(),
  completedAt: null,
  selectedCaseIds,
  processedCaseIds: [],
  successfulClassifications: 0,
  httpAttempts: 0,
  estimatedCostUsd: 0,
  error: null,
  retryCaseId: null,
  stopReason: null,
};
state.lastBatch = batch;
await writeState(state);

console.log(
  `starting Jev batch: ${selectedCaseIds.length} URL(s), at most ${selectedCaseIds.length * state.repetitions} successful classifications; batch limit=${batchSize}`,
);

let stopForApiError = false;

for (const caseId of selectedCaseIds) {
  const item = state.cases.find(({ id }) => id === caseId);
  if (!item) continue;

  let validated = preparedCases.get(caseId) ?? null;
  if (!validated) {
    try {
      validated = await validateCandidate(fixtureFromStored(item));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item.error = `re-extraction failed: ${message}`;
      batch.processedCaseIds.push(item.id);
      await writeState(state);
      console.log(`skip ${item.id}: ${item.error}`);
      continue;
    }
  }

  if (!validated) {
    item.error =
      "re-extraction no longer satisfies the stored recipe/non-recipe label";
    batch.processedCaseIds.push(item.id);
    await writeState(state);
    console.log(`skip ${item.id}: ${item.error}`);
    continue;
  }

  if (
    item.runs.length > 0 &&
    item.extraction !== null &&
    item.extraction.textSha256 !== validated.extraction.textSha256
  ) {
    item.error =
      "re-extracted content changed after partial Jev evaluation; reset or refresh before continuing this URL";
    batch.processedCaseIds.push(item.id);
    await writeState(state);
    console.log(`skip ${item.id}: ${item.error}`);
    continue;
  }

  item.extraction = validated.extraction;

  for (
    let repetition = item.runs.length + 1;
    repetition <= state.repetitions;
    repetition += 1
  ) {
    process.stdout.write(
      `Jev ${repetition}/${state.repetitions} ${item.expected} ${item.id} ... `,
    );

    try {
      const classification = await classifyRecipeContent(
        validated.pageContent,
        {
          apiKey,
          model,
        },
      );
      const run = { repetition, ...classification };
      item.runs.push(run);
      batch.successfulClassifications += 1;
      batch.httpAttempts += classification.attempts;
      batch.estimatedCostUsd += classification.estimatedCostUsd;
      await writeState(state);
      console.log(
        `${classification.choice} p(non_recipe)=${classification.nonRecipeProbability.toFixed(4)} confidence=${classification.confidence.toFixed(4)} ${classification.elapsedMs}ms cost=$${classification.estimatedCostUsd.toFixed(6)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      batch.error = `Jev evaluation failed for ${item.id}: ${message}`;
      batch.retryCaseId = item.id;
      batch.stopReason = "api-error";
      await writeState(state);
      console.log(`ERROR ${message}`);
      stopForApiError = true;
      break;
    }
  }

  batch.processedCaseIds.push(item.id);
  await writeState(state);
  if (stopForApiError) break;
}

batch.completedAt = new Date().toISOString();
batch.stopReason ??= "batch-limit";
await writeState(state);

console.log(
  `\nbatch finished: processed URLs=${batch.processedCaseIds.length}/${batch.selectedCaseIds.length}, successful classifications=${batch.successfulClassifications}, HTTP attempts=${batch.httpAttempts}`,
);
console.log(
  `batch estimated cost: $${batch.estimatedCostUsd.toFixed(6)}; cumulative estimated cost: $${state.pricing.totalEstimatedCostUsd.toFixed(6)}`,
);
console.log(
  `progress: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}, failed=${state.failedCaseCount}, total=${state.fixtureCount}`,
);
console.log(`results: ${path.relative(root, outputPath)}`);

if (state.qualifiedCandidateThreshold !== null) {
  console.log(
    `qualified candidate threshold: ${state.qualifiedCandidateThreshold.toFixed(2)} (full corpus and all repetitions complete; still requires review before production use)`,
  );
} else if (state.provisionalCandidateThreshold !== null) {
  console.log(
    `provisional threshold from completed cases: ${state.provisionalCandidateThreshold.toFixed(2)} (not production-qualified)`,
  );
} else {
  console.log("candidate threshold: none from completed cases");
}

if (stopForApiError) {
  console.error(
    "Batch stopped after an API error to avoid additional consumption. The checkpoint is saved; inspect the result file before continuing.",
  );
  process.exitCode = 1;
} else if (!state.technicalComplete) {
  console.log(
    "Run the same command again when you want to process the next batch of up to 100 URLs.",
  );
}
