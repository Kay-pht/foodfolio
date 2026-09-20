import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AnalysisError } from "../../src/application/analysis/types.js";
import { AiAwareSourceContentExtractor } from "../../src/infrastructure/url/ai-aware-source-content-extractor.js";
import {
  ChatGptSharedConversationAdapter,
  GeminiSharedConversationAdapter,
} from "../../src/infrastructure/url/ai-shared-conversation.js";
import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";
import {
  classifyRecipeContent,
  DEFAULT_JEV_MODEL,
  JEV_INPUT_USD_PER_MILLION,
  jevHttpAttemptsFromError,
  type JevRecipeClassification,
} from "./jev.js";
import {
  evaluationFixtureForLiveCase,
  LIVE_MEDIA_TARGET_URL_COUNT,
  parseLiveMediaCorpus,
  type LiveMediaCorpusCase,
  type LiveMediaSource,
} from "./media-live-corpus.js";
import {
  DEFAULT_MEDIA_RECIPE_THRESHOLDS,
  evaluateMediaRouting,
  type JevMediaObservation,
  type MediaRoutingEvaluation,
  type MediaThresholdMetric,
} from "./media-routing.js";
import type { MediaRoutingFixture } from "./media-fixtures.js";

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_REPETITIONS = 3;
const MAX_REPETITIONS = 10;
const DEFAULT_CALL_BUDGET = 100;
const MAX_CALL_BUDGET = 100;

const root = process.cwd();
const defaultCorpusPath = path.join(
  root,
  "poc/inputs/jev-media-live-corpus.json",
);
const resultsDirectory = path.join(root, "poc/results");
const outputPath = path.join(resultsDirectory, "jev-media-live-results.json");

interface CaseRun extends JevRecipeClassification {
  repetition: number;
}

interface LiveExtractionRecord {
  capturedAt: string;
  resolvedUrl: string | null;
  sourceType: string | null;
  textLength: number;
  textSha256: string | null;
  tiktokMediaKind: "photo" | "video" | null;
  error: {
    code: string;
    retryable: boolean;
    message: string;
  } | null;
}

type ClassificationSkipped =
  "no-text" | "extraction-error" | "content-changed" | null;

interface LiveCaseResult extends LiveMediaCorpusCase {
  extraction: LiveExtractionRecord | null;
  fixture: MediaRoutingFixture | null;
  classificationSkipped: ClassificationSkipped;
  runs: CaseRun[];
}

interface BatchRecord {
  startedAt: string;
  completedAt: string | null;
  callBudget: number;
  selectedCaseIds: string[];
  processedCaseIds: string[];
  successfulClassifications: number;
  httpAttempts: number;
  estimatedCostUsd: number;
  error: string | null;
  retryCaseId: string | null;
  stopReason:
    | "call-budget"
    | "api-error"
    | "extraction-error"
    | "content-changed"
    | "no-pending-cases"
    | "complete"
    | null;
}

interface LiveValidationSummary {
  targetUrlCount: number;
  corpusTargetMet: boolean;
  sourceCounts: Record<LiveMediaSource, number>;
  terminalInvalidCaseIds: string[];
  threshold099: MediaThresholdMetric | null;
  observedUnsafeFastRouteCaseIdsAt099: string[];
  observedFastRouteCoverageAt099: number | null;
  observedSafeFallbackCoverageAt099: number | null;
  validationReady: boolean;
  productionQualified: false;
}

interface LiveMediaResultState {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  purpose: string;
  phase: "batch-evaluation" | "complete";
  modelRequested: string;
  repetitions: number;
  callBudget: number;
  corpusPath: string;
  corpusHash: string;
  corpusCount: number;
  completedCaseCount: number;
  pendingCaseCount: number;
  technicalComplete: boolean;
  thresholds: number[];
  pricing: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    totalEstimatedCostUsd: number;
  };
  evaluation: MediaRoutingEvaluation;
  validation: LiveValidationSummary;
  lastBatch: BatchRecord | null;
  cases: LiveCaseResult[];
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function corpusHash(cases: readonly LiveMediaCorpusCase[]): string {
  return createHash("sha256").update(JSON.stringify(cases)).digest("hex");
}

function textSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function observations(state: LiveMediaResultState): JevMediaObservation[] {
  return state.cases.flatMap((item) =>
    item.runs.map((run) => ({
      fixtureId: item.id,
      repetition: run.repetition,
      choice: run.choice,
      recipeProbability: run.recipeProbability,
      nonRecipeProbability: run.nonRecipeProbability,
    })),
  );
}

function currentEstimatedCostUsd(state: LiveMediaResultState): number {
  return state.cases.reduce(
    (caseTotal, item) =>
      caseTotal +
      item.runs.reduce((runTotal, run) => runTotal + run.estimatedCostUsd, 0),
    0,
  );
}

function caseComplete(item: LiveCaseResult, repetitions: number): boolean {
  return item.classificationSkipped !== null || item.runs.length >= repetitions;
}

function sourceCounts(
  cases: readonly LiveCaseResult[],
): Record<LiveMediaSource, number> {
  const counts: Record<LiveMediaSource, number> = {
    youtube: 0,
    instagram: 0,
    tiktok: 0,
    chatgpt: 0,
    gemini: 0,
  };
  for (const item of cases) counts[item.source] += 1;
  return counts;
}

function updateDerivedState(state: LiveMediaResultState): void {
  const fixtures = state.cases
    .map(({ fixture }) => fixture)
    .filter((fixture): fixture is MediaRoutingFixture => fixture !== null);
  state.evaluation = evaluateMediaRouting(
    fixtures,
    observations(state),
    state.repetitions,
    state.thresholds,
  );

  const completed = state.cases.filter((item) =>
    caseComplete(item, state.repetitions),
  );
  const pending = state.cases.filter(
    (item) => !caseComplete(item, state.repetitions),
  );
  const terminalInvalidCaseIds = state.cases
    .filter(
      ({ classificationSkipped }) =>
        classificationSkipped === "extraction-error" ||
        classificationSkipped === "content-changed",
    )
    .map(({ id }) => id)
    .sort();

  state.completedCaseCount = completed.length;
  state.pendingCaseCount = pending.length;
  state.technicalComplete = pending.length === 0;
  state.pricing.totalEstimatedCostUsd = currentEstimatedCostUsd(state);
  state.phase = state.technicalComplete ? "complete" : "batch-evaluation";

  const threshold099 =
    state.evaluation.thresholds.find(
      ({ threshold }) => Math.abs(threshold - 0.99) < 1e-9,
    ) ?? null;
  state.validation = {
    targetUrlCount: LIVE_MEDIA_TARGET_URL_COUNT,
    corpusTargetMet: state.corpusCount >= LIVE_MEDIA_TARGET_URL_COUNT,
    sourceCounts: sourceCounts(state.cases),
    terminalInvalidCaseIds,
    threshold099,
    observedUnsafeFastRouteCaseIdsAt099:
      threshold099?.combinedRouting.unsafeFastRouteCaseIds ?? [],
    observedFastRouteCoverageAt099:
      threshold099?.combinedRouting.consistentFastRouteCoverage ?? null,
    observedSafeFallbackCoverageAt099:
      threshold099?.combinedRouting.safeFallbackCoverage ?? null,
    validationReady:
      state.technicalComplete &&
      state.corpusCount >= LIVE_MEDIA_TARGET_URL_COUNT &&
      terminalInvalidCaseIds.length === 0 &&
      state.evaluation.completeFixtureCount === state.corpusCount,
    productionQualified: false,
  };
  state.updatedAt = new Date().toISOString();
}

async function writeState(state: LiveMediaResultState): Promise<void> {
  updateDerivedState(state);
  await fs.mkdir(resultsDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, outputPath);
}

async function readState(): Promise<LiveMediaResultState | null> {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as LiveMediaResultState;
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new Error(
        `Existing live-media result state uses an unsupported schema. Run with JEV_MEDIA_LIVE_POC_RESET=1 to rebuild ${path.relative(root, outputPath)}.`,
      );
    }
    return parsed;
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
  cases: readonly LiveMediaCorpusCase[],
  model: string,
  repetitions: number,
  callBudget: number,
  corpusPath: string,
): LiveMediaResultState {
  const now = new Date().toISOString();
  const results: LiveCaseResult[] = cases.map((item) => ({
    ...item,
    extraction: null,
    fixture: null,
    classificationSkipped: null,
    runs: [],
  }));
  const state: LiveMediaResultState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    purpose:
      "Validate Jev media-routing safety on manually labeled real public URLs using the same production source-content extractors, without changing production routing.",
    phase: "batch-evaluation",
    modelRequested: model,
    repetitions,
    callBudget,
    corpusPath,
    corpusHash: corpusHash(cases),
    corpusCount: results.length,
    completedCaseCount: 0,
    pendingCaseCount: results.length,
    technicalComplete: false,
    thresholds: [...DEFAULT_MEDIA_RECIPE_THRESHOLDS],
    pricing: {
      inputUsdPerMillionTokens: JEV_INPUT_USD_PER_MILLION,
      outputUsdPerMillionTokens: 0,
      totalEstimatedCostUsd: 0,
    },
    evaluation: evaluateMediaRouting(
      [],
      [],
      repetitions,
      DEFAULT_MEDIA_RECIPE_THRESHOLDS,
    ),
    validation: {
      targetUrlCount: LIVE_MEDIA_TARGET_URL_COUNT,
      corpusTargetMet: results.length >= LIVE_MEDIA_TARGET_URL_COUNT,
      sourceCounts: sourceCounts(results),
      terminalInvalidCaseIds: [],
      threshold099: null,
      observedUnsafeFastRouteCaseIdsAt099: [],
      observedFastRouteCoverageAt099: null,
      observedSafeFallbackCoverageAt099: null,
      validationReady: false,
      productionQualified: false,
    },
    lastBatch: null,
    cases: results,
  };
  updateDerivedState(state);
  return state;
}

function assertCompatibleState(
  state: LiveMediaResultState,
  cases: readonly LiveMediaCorpusCase[],
  model: string,
  repetitions: number,
): void {
  const currentHash = corpusHash(cases);
  if (
    state.modelRequested !== model ||
    state.repetitions !== repetitions ||
    state.corpusHash !== currentHash
  ) {
    throw new Error(
      [
        "Existing live-media result checkpoint is incompatible with the requested run.",
        `saved model=${state.modelRequested}, repetitions=${state.repetitions}, corpusHash=${state.corpusHash}`,
        `current model=${model}, repetitions=${repetitions}, corpusHash=${currentHash}`,
        "Run with JEV_MEDIA_LIVE_POC_RESET=1 after intentionally changing the corpus, model, or repetition count.",
      ].join(" "),
    );
  }
}

function selectCaseIds(state: LiveMediaResultState): string[] {
  const pending = state.cases.filter(
    (item) => !caseComplete(item, state.repetitions),
  );
  const retryCaseId =
    state.lastBatch?.stopReason === "api-error" ||
    state.lastBatch?.stopReason === "extraction-error"
      ? state.lastBatch.retryCaseId
      : null;
  const retry = pending.filter(({ id }) => id === retryCaseId);
  const retryIds = new Set(retry.map(({ id }) => id));
  const partial = pending.filter(
    (item) => !retryIds.has(item.id) && item.runs.length > 0,
  );
  const fresh = pending.filter(
    (item) => !retryIds.has(item.id) && item.runs.length === 0,
  );
  return [...retry, ...partial, ...fresh].map(({ id }) => id);
}

function extractionError(error: unknown): {
  code: string;
  retryable: boolean;
  message: string;
} {
  if (error instanceof AnalysisError) {
    return {
      code: error.code,
      retryable: error.retryable,
      message: error.message,
    };
  }
  return {
    code: "LIVE_SOURCE_EXTRACTION_FAILED",
    retryable: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

function extractionRecord(
  source: Awaited<ReturnType<AiAwareSourceContentExtractor["extract"]>>,
): LiveExtractionRecord {
  const text = source.textForAi;
  return {
    capturedAt: new Date().toISOString(),
    resolvedUrl: source.resolvedUrl,
    sourceType: source.sourceType,
    textLength: text?.length ?? 0,
    textSha256: text ? textSha256(text) : null,
    tiktokMediaKind: source.tiktokMediaKind ?? null,
    error: null,
  };
}

const corpusPath = path.resolve(
  root,
  process.env.JEV_MEDIA_LIVE_CORPUS_PATH?.trim() || defaultCorpusPath,
);
const rawCorpus = await fs.readFile(corpusPath, "utf8").catch((error) => {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    throw new Error(
      `Live media corpus not found at ${path.relative(root, corpusPath)}. Copy poc/jev-recipe-gate/media-live-corpus.example.json to poc/inputs/jev-media-live-corpus.json and replace the examples with manually labeled public URLs.`,
    );
  }
  throw error;
});
const corpus = parseLiveMediaCorpus(JSON.parse(rawCorpus) as unknown);
const model = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
const repetitions = parsePositiveInteger(
  process.env.JEV_MEDIA_LIVE_POC_REPETITIONS,
  DEFAULT_REPETITIONS,
  MAX_REPETITIONS,
  "JEV_MEDIA_LIVE_POC_REPETITIONS",
);
const callBudget = parsePositiveInteger(
  process.env.JEV_MEDIA_LIVE_POC_CALL_BUDGET,
  DEFAULT_CALL_BUDGET,
  MAX_CALL_BUDGET,
  "JEV_MEDIA_LIVE_POC_CALL_BUDGET",
);
const reset = envFlag(process.env.JEV_MEDIA_LIVE_POC_RESET);

if (reset) await fs.rm(outputPath, { force: true });

let state = await readState();
if (state) {
  assertCompatibleState(state, corpus.cases, model, repetitions);
  state.callBudget = callBudget;
  state.corpusPath = path.relative(root, corpusPath);
} else {
  state = emptyState(
    corpus.cases,
    model,
    repetitions,
    callBudget,
    path.relative(root, corpusPath),
  );
}
await writeState(state);

console.log(
  `Jev live media routing PoC: URLs=${state.corpusCount}, target=${LIVE_MEDIA_TARGET_URL_COUNT}, repetitions=${state.repetitions}`,
);
console.log(
  `progress: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}`,
);
console.log(
  `per-invocation Jev successful-classification budget: ${state.callBudget}`,
);
console.log(`checkpoint: ${path.relative(root, outputPath)}`);

const selectedCaseIds = selectCaseIds(state);
if (selectedCaseIds.length === 0) {
  state.lastBatch = {
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    callBudget,
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
  console.log("No pending live-media URLs.");
  console.log(
    `0.99 unsafe fast-route cases: ${state.validation.observedUnsafeFastRouteCaseIdsAt099.length}`,
  );
  console.log(
    `validation ready: ${state.validation.validationReady ? "yes" : "no"}`,
  );
  process.exit(0);
}

const youtubeApiKey = process.env.YOUTUBE_API_KEY?.trim();
if (corpus.cases.some(({ source }) => source === "youtube") && !youtubeApiKey) {
  throw new Error(
    "YOUTUBE_API_KEY is required because the live-media corpus contains YouTube URLs",
  );
}
const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "TYPESAFE_API_KEY is required before running a Jev live-media evaluation batch",
  );
}

const http = new SafeHttpClient();
const fallback = new ProductionSourceContentExtractor(
  http,
  youtubeApiKey ?? "",
  fetch,
  true,
);
const extractor = new AiAwareSourceContentExtractor(
  fallback,
  new ChatGptSharedConversationAdapter(http),
  new GeminiSharedConversationAdapter(),
);

const batch: BatchRecord = {
  startedAt: new Date().toISOString(),
  completedAt: null,
  callBudget,
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

let stopped = false;
for (const caseId of selectedCaseIds) {
  if (batch.successfulClassifications >= callBudget) {
    batch.stopReason = "call-budget";
    break;
  }

  const item = state.cases.find(({ id }) => id === caseId);
  const label = corpus.cases.find(({ id }) => id === caseId);
  if (!item || !label) continue;

  process.stdout.write(`extract ${item.source} ${item.id} ... `);
  let source;
  try {
    source = await extractor.extract(new URL(item.url));
  } catch (error) {
    const details = extractionError(error);
    item.extraction = {
      capturedAt: new Date().toISOString(),
      resolvedUrl: null,
      sourceType: item.source,
      textLength: 0,
      textSha256: null,
      tiktokMediaKind: null,
      error: details,
    };
    if (details.retryable) {
      batch.error = `Source extraction failed for ${item.id}: ${details.message}`;
      batch.retryCaseId = item.id;
      batch.stopReason = "extraction-error";
      console.log(`ERROR ${details.code}: ${details.message}`);
      await writeState(state);
      stopped = true;
      break;
    }

    item.classificationSkipped = "extraction-error";
    batch.processedCaseIds.push(item.id);
    console.log(`terminal ${details.code}: ${details.message}`);
    await writeState(state);
    continue;
  }

  const extracted = extractionRecord(source);
  const previousHash = item.extraction?.textSha256;
  if (
    item.runs.length > 0 &&
    previousHash &&
    extracted.textSha256 &&
    previousHash !== extracted.textSha256
  ) {
    item.classificationSkipped = "content-changed";
    item.extraction = {
      ...extracted,
      error: {
        code: "LIVE_SOURCE_CONTENT_CHANGED",
        retryable: false,
        message:
          "Source text changed after Jev evidence was already checkpointed; reset or replace this corpus case before using it for threshold validation.",
      },
    };
    batch.error = `Source content changed for ${item.id}`;
    batch.stopReason = "content-changed";
    batch.processedCaseIds.push(item.id);
    console.log("CONTENT CHANGED");
    await writeState(state);
    stopped = true;
    break;
  }

  item.extraction = extracted;
  item.fixture = evaluationFixtureForLiveCase(label, source);
  console.log(
    `ok chars=${extracted.textLength} resolved=${extracted.resolvedUrl ?? "n/a"}`,
  );

  if (!source.textForAi) {
    item.classificationSkipped = "no-text";
    batch.processedCaseIds.push(item.id);
    await writeState(state);
    continue;
  }

  for (
    let repetition = item.runs.length + 1;
    repetition <= state.repetitions;
    repetition += 1
  ) {
    if (batch.successfulClassifications >= callBudget) {
      batch.stopReason = "call-budget";
      stopped = true;
      break;
    }

    process.stdout.write(
      `Jev ${repetition}/${state.repetitions} ${item.source} ${item.id} ... `,
    );
    try {
      const classification = await classifyRecipeContent(source.textForAi, {
        apiKey,
        model,
      });
      item.runs.push({ repetition, ...classification });
      batch.successfulClassifications += 1;
      batch.httpAttempts += classification.attempts;
      batch.estimatedCostUsd += classification.estimatedCostUsd;
      console.log(
        `${classification.choice} p(recipe)=${classification.recipeProbability.toFixed(4)} p(non_recipe)=${classification.nonRecipeProbability.toFixed(4)} ${classification.elapsedMs}ms cost=$${classification.estimatedCostUsd.toFixed(6)}`,
      );
      await writeState(state);
    } catch (error) {
      batch.httpAttempts += jevHttpAttemptsFromError(error);
      const message = error instanceof Error ? error.message : String(error);
      batch.error = `Jev evaluation failed for ${item.id}: ${message}`;
      batch.retryCaseId = item.id;
      batch.stopReason = "api-error";
      console.log(`ERROR ${message}`);
      await writeState(state);
      stopped = true;
      break;
    }
  }

  batch.processedCaseIds.push(item.id);
  await writeState(state);
  if (stopped) break;
}

batch.completedAt = new Date().toISOString();
updateDerivedState(state);
batch.stopReason ??= state.technicalComplete ? "complete" : "call-budget";
await writeState(state);

console.log(
  `\nbatch finished: processed URLs=${batch.processedCaseIds.length}, successful Jev classifications=${batch.successfulClassifications}/${batch.callBudget}, HTTP attempts=${batch.httpAttempts}`,
);
console.log(
  `batch estimated cost: $${batch.estimatedCostUsd.toFixed(6)}; cumulative estimated cost: $${state.pricing.totalEstimatedCostUsd.toFixed(6)}`,
);
console.log(
  `progress: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}, total=${state.corpusCount}`,
);
console.log(
  `classification accuracy on completed evidence: ${(state.evaluation.classification.accuracy * 100).toFixed(2)}%`,
);
console.log(
  `0.99 unsafe fast-route cases: ${state.validation.observedUnsafeFastRouteCaseIdsAt099.length}`,
);
console.log(
  `0.99 stable fast-route coverage: ${state.validation.observedFastRouteCoverageAt099 === null ? "n/a" : (state.validation.observedFastRouteCoverageAt099 * 100).toFixed(2) + "%"}`,
);
console.log(
  `0.99 safe fallback coverage: ${state.validation.observedSafeFallbackCoverageAt099 === null ? "n/a" : (state.validation.observedSafeFallbackCoverageAt099 * 100).toFixed(2) + "%"}`,
);
console.log(
  `validation ready: ${state.validation.validationReady ? "yes" : "no"} (productionQualified is always false in this PoC)`,
);
console.log(`results: ${path.relative(root, outputPath)}`);

if (
  batch.stopReason === "api-error" ||
  batch.stopReason === "extraction-error"
) {
  console.error(
    "Batch stopped after a retryable external error. The checkpoint is saved and the interrupted URL will be retried first.",
  );
  process.exitCode = 1;
} else if (batch.stopReason === "content-changed") {
  console.error(
    "Batch stopped because a URL changed after partial Jev evidence was recorded. Review that URL and reset or replace the corpus case before treating the validation as complete.",
  );
  process.exitCode = 1;
} else if (!state.technicalComplete) {
  console.log(
    "Run npm run poc:jev-media-live again when you want to consume the next batch.",
  );
}
