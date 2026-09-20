import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyRecipeContent,
  DEFAULT_JEV_MODEL,
  JEV_INPUT_USD_PER_MILLION,
  jevHttpAttemptsFromError,
  type JevRecipeClassification,
} from "./jev.js";
import {
  MEDIA_ROUTING_FIXTURES,
  type MediaRoutingFixture,
} from "./media-fixtures.js";
import {
  DEFAULT_MEDIA_RECIPE_THRESHOLDS,
  evaluateMediaRouting,
  youtubeSufficiency,
  type JevMediaObservation,
} from "./media-routing.js";

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_REPETITIONS = 3;
const MAX_REPETITIONS = 10;
const root = process.cwd();
const resultsDirectory = path.join(root, "poc/results");
const outputPath = path.join(
  resultsDirectory,
  "jev-media-routing-results.json",
);

interface CaseRun extends JevRecipeClassification {
  repetition: number;
}

interface MediaCaseResult {
  id: string;
  platform: MediaRoutingFixture["platform"];
  expectedKind: MediaRoutingFixture["expectedKind"];
  expectedRoute: MediaRoutingFixture["expectedRoute"];
  provenance: MediaRoutingFixture["provenance"];
  rationale: string;
  youtubeSufficiency: ReturnType<typeof youtubeSufficiency> | null;
  classificationSkipped: "no-text" | null;
  runs: CaseRun[];
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

interface MediaResultState {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  purpose: string;
  phase: "batch-evaluation" | "complete";
  modelRequested: string;
  repetitions: number;
  batchSize: number;
  fixtureHash: string;
  fixtureCount: number;
  jevFixtureCount: number;
  completedCaseCount: number;
  pendingCaseCount: number;
  technicalComplete: boolean;
  thresholds: number[];
  routingPolicy: {
    youtube: string;
    instagram: string;
    tiktok: string;
    aiChat: string;
  };
  pricing: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    totalEstimatedCostUsd: number;
  };
  evaluation: ReturnType<typeof evaluateMediaRouting>;
  lastBatch: BatchRecord | null;
  cases: MediaCaseResult[];
}

function parseRepetitions(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_REPETITIONS);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_REPETITIONS) {
    throw new Error(
      `JEV_MEDIA_POC_REPETITIONS must be an integer from 1 to ${MAX_REPETITIONS}`,
    );
  }
  return parsed;
}

function parseMediaBatchSize(value: string | undefined): number {
  const parsed = Number(value ?? 100);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(
      "JEV_MEDIA_POC_BATCH_SIZE must be an integer from 1 to 100",
    );
  }
  return parsed;
}

function envFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function fixtureHash(): string {
  return createHash("sha256")
    .update(JSON.stringify(MEDIA_ROUTING_FIXTURES))
    .digest("hex");
}

function fixtureById(id: string): MediaRoutingFixture {
  const fixture = MEDIA_ROUTING_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown media fixture: ${id}`);
  return fixture;
}

function observations(state: MediaResultState): JevMediaObservation[] {
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

function currentEstimatedCostUsd(state: MediaResultState): number {
  return state.cases.reduce(
    (caseTotal, item) =>
      caseTotal +
      item.runs.reduce(
        (runTotal, run) => runTotal + run.estimatedCostUsd,
        0,
      ),
    0,
  );
}

function updateDerivedState(state: MediaResultState): void {
  const completed = state.cases.filter(
    (item) =>
      item.classificationSkipped === "no-text" ||
      item.runs.length >= state.repetitions,
  );
  const pending = state.cases.filter(
    (item) =>
      item.classificationSkipped === null &&
      item.runs.length < state.repetitions,
  );
  state.fixtureCount = state.cases.length;
  state.jevFixtureCount = state.cases.filter(
    ({ classificationSkipped }) => classificationSkipped === null,
  ).length;
  state.completedCaseCount = completed.length;
  state.pendingCaseCount = pending.length;
  state.technicalComplete = pending.length === 0;
  state.pricing.totalEstimatedCostUsd = currentEstimatedCostUsd(state);
  state.evaluation = evaluateMediaRouting(
    MEDIA_ROUTING_FIXTURES,
    observations(state),
    state.repetitions,
    state.thresholds,
  );
  state.phase = state.technicalComplete ? "complete" : "batch-evaluation";
  state.updatedAt = new Date().toISOString();
}

async function writeState(state: MediaResultState): Promise<void> {
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

async function readState(): Promise<MediaResultState | null> {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as MediaResultState;
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new Error(
        `Existing media result state uses an unsupported schema. Run with JEV_MEDIA_POC_RESET=1 to rebuild ${path.relative(root, outputPath)}.`,
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
  model: string,
  repetitions: number,
  batchSize: number,
): MediaResultState {
  const now = new Date().toISOString();
  const cases: MediaCaseResult[] = MEDIA_ROUTING_FIXTURES.map((fixture) => ({
    id: fixture.id,
    platform: fixture.platform,
    expectedKind: fixture.expectedKind,
    expectedRoute: fixture.expectedRoute,
    provenance: fixture.provenance,
    rationale: fixture.rationale,
    youtubeSufficiency:
      fixture.platform === "youtube" ? youtubeSufficiency(fixture) : null,
    classificationSkipped: fixture.input ? null : "no-text",
    runs: [],
  }));

  const state: MediaResultState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    purpose:
      "Evaluate Jev semantic classification separately from proposed YouTube/Instagram/TikTok routing safety and AI-chat recipe classification.",
    phase: "batch-evaluation",
    modelRequested: model,
    repetitions,
    batchSize,
    fixtureHash: fixtureHash(),
    fixtureCount: cases.length,
    jevFixtureCount: cases.filter(
      ({ classificationSkipped }) => classificationSkipped === null,
    ).length,
    completedCaseCount: 0,
    pendingCaseCount: 0,
    technicalComplete: false,
    thresholds: [...DEFAULT_MEDIA_RECIPE_THRESHOLDS],
    routingPolicy: {
      youtube:
        "Z.ai only when existing description sufficiency passes and p(recipe) >= threshold; otherwise Gemini.",
      instagram:
        "Text only when source text exists and p(recipe) >= threshold; otherwise media analysis.",
      tiktok:
        "Text only when source text exists and p(recipe) >= threshold; otherwise media analysis.",
      aiChat:
        "Classification only: one specific recipe versus non-recipe. No downstream routing change.",
    },
    pricing: {
      inputUsdPerMillionTokens: JEV_INPUT_USD_PER_MILLION,
      outputUsdPerMillionTokens: 0,
      totalEstimatedCostUsd: 0,
    },
    evaluation: evaluateMediaRouting(
      MEDIA_ROUTING_FIXTURES,
      [],
      repetitions,
      DEFAULT_MEDIA_RECIPE_THRESHOLDS,
    ),
    lastBatch: null,
    cases,
  };
  updateDerivedState(state);
  return state;
}

function assertCompatibleState(
  state: MediaResultState,
  model: string,
  repetitions: number,
): void {
  const currentHash = fixtureHash();
  if (
    state.modelRequested !== model ||
    state.repetitions !== repetitions ||
    state.fixtureHash !== currentHash
  ) {
    throw new Error(
      [
        "Existing media result checkpoint is incompatible with the requested run.",
        `saved model=${state.modelRequested}, repetitions=${state.repetitions}, fixtureHash=${state.fixtureHash}`,
        `current model=${model}, repetitions=${repetitions}, fixtureHash=${currentHash}`,
        "Run with JEV_MEDIA_POC_RESET=1 to rebuild the media checkpoint.",
      ].join(" "),
    );
  }
}

function selectCaseIds(
  state: MediaResultState,
  batchSize: number,
): string[] {
  const pending = state.cases.filter(
    (item) =>
      item.classificationSkipped === null &&
      item.runs.length < state.repetitions,
  );
  const retryCaseId =
    state.lastBatch?.stopReason === "api-error"
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
  return [...retry, ...partial, ...fresh]
    .slice(0, batchSize)
    .map(({ id }) => id);
}

const model = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
const repetitions = parseRepetitions(process.env.JEV_MEDIA_POC_REPETITIONS);
const batchSize = parseMediaBatchSize(process.env.JEV_MEDIA_POC_BATCH_SIZE);
const reset = envFlag(process.env.JEV_MEDIA_POC_RESET);

if (reset) {
  await fs.rm(outputPath, { force: true });
}

let state = await readState();
if (state) {
  assertCompatibleState(state, model, repetitions);
  state.batchSize = batchSize;
} else {
  state = emptyState(model, repetitions, batchSize);
}
await writeState(state);

console.log(
  `Jev media routing PoC: fixtures=${state.fixtureCount}, Jev fixtures=${state.jevFixtureCount}, repetitions=${state.repetitions}`,
);
console.log(
  `progress: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}`,
);
console.log(`checkpoint: ${path.relative(root, outputPath)}`);

const selectedCaseIds = selectCaseIds(state, batchSize);
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
  console.log("No pending media fixtures.");
  console.log(
    `classification accuracy: ${(state.evaluation.classification.accuracy * 100).toFixed(2)}%`,
  );
  console.log(
    `experimental combined candidate p(recipe) threshold: ${state.evaluation.candidateRecipeThreshold?.toFixed(2) ?? "none"}`,
  );
  process.exit(0);
}

const apiKey = process.env.TYPESAFE_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "TYPESAFE_API_KEY is required before running a Jev media evaluation batch",
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
  `starting media batch: ${selectedCaseIds.length} fixture(s), at most ${selectedCaseIds.length * state.repetitions} successful classifications`,
);

let stoppedForApiError = false;
for (const caseId of selectedCaseIds) {
  const item = state.cases.find(({ id }) => id === caseId);
  if (!item) continue;
  const fixture = fixtureById(caseId);
  if (!fixture.input) continue;

  for (
    let repetition = item.runs.length + 1;
    repetition <= state.repetitions;
    repetition += 1
  ) {
    process.stdout.write(
      `Jev ${repetition}/${state.repetitions} ${fixture.platform} ${fixture.id} ... `,
    );
    try {
      const classification = await classifyRecipeContent(fixture.input, {
        apiKey,
        model,
      });
      item.runs.push({ repetition, ...classification });
      batch.successfulClassifications += 1;
      batch.httpAttempts += classification.attempts;
      batch.estimatedCostUsd += classification.estimatedCostUsd;
      await writeState(state);
      console.log(
        `${classification.choice} p(recipe)=${classification.recipeProbability.toFixed(4)} p(non_recipe)=${classification.nonRecipeProbability.toFixed(4)} confidence=${classification.confidence.toFixed(4)} ${classification.elapsedMs}ms cost=$${classification.estimatedCostUsd.toFixed(6)}`,
      );
    } catch (error) {
      batch.httpAttempts += jevHttpAttemptsFromError(error);
      const message = error instanceof Error ? error.message : String(error);
      batch.error = `Jev evaluation failed for ${fixture.id}: ${message}`;
      batch.retryCaseId = fixture.id;
      batch.stopReason = "api-error";
      await writeState(state);
      console.log(`ERROR ${message}`);
      stoppedForApiError = true;
      break;
    }
  }

  batch.processedCaseIds.push(item.id);
  await writeState(state);
  if (stoppedForApiError) break;
}

batch.completedAt = new Date().toISOString();
batch.stopReason ??= "batch-limit";
await writeState(state);

console.log(
  `\nbatch finished: processed fixtures=${batch.processedCaseIds.length}/${batch.selectedCaseIds.length}, successful classifications=${batch.successfulClassifications}, HTTP attempts=${batch.httpAttempts}`,
);
console.log(
  `batch estimated cost: $${batch.estimatedCostUsd.toFixed(6)}; cumulative estimated cost: $${state.pricing.totalEstimatedCostUsd.toFixed(6)}`,
);
console.log(
  `progress: completed=${state.completedCaseCount}, pending=${state.pendingCaseCount}, total=${state.fixtureCount}`,
);
console.log(
  `classification accuracy on completed classified fixtures: ${(state.evaluation.classification.accuracy * 100).toFixed(2)}%`,
);
console.log(
  `experimental combined candidate p(recipe) threshold: ${state.evaluation.candidateRecipeThreshold?.toFixed(2) ?? "none"}`,
);
console.log(`results: ${path.relative(root, outputPath)}`);

if (stoppedForApiError) {
  console.error(
    "Batch stopped after an API error to avoid additional consumption. The checkpoint is saved.",
  );
  process.exitCode = 1;
} else if (!state.technicalComplete) {
  console.log(
    "Run npm run poc:jev-media again when you want to process the next batch.",
  );
}
