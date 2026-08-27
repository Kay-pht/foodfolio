import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import expectedFixtures from "./results/expected.json" with { type: "json" };
import recipeSchema from "../shared/recipe-schema.json" with { type: "json" };
import { parseAndEvaluate } from "./evaluate.js";
import {
  callGeminiUrlContext,
  geminiUrlContextCostUsd,
} from "./gemini-url-context.js";
import type { ExpectedFixture } from "./types.js";

const COST_CAP_USD = 5;
const MAX_MODEL_INPUT_TOKENS = 1_048_576;
const MAX_OUTPUT_TOKENS = 4_000;
const root = process.cwd();
const resultsPath = path.join(
  root,
  "poc/results/gemini-url-context-results.json",
);
const artifactsDirectory = path.join(root, "poc/artifacts/gemini-url-context");
const fixtures = (expectedFixtures as ExpectedFixture[]).filter(
  ({ id }) => !id.startsWith("youtube-"),
);
const conservativeCostUsd =
  fixtures.length *
  ((MAX_MODEL_INPUT_TOKENS * 0.3 + MAX_OUTPUT_TOKENS * 2.5) / 1_000_000);
if (conservativeCostUsd > COST_CAP_USD) {
  throw new Error(
    `conservative URL Context cost $${conservativeCostUsd.toFixed(4)} exceeds $${COST_CAP_USD} cap`,
  );
}

await fs.mkdir(path.dirname(resultsPath), { recursive: true });
await fs.mkdir(artifactsDirectory, { recursive: true });
console.log(
  `planned: ${fixtures.length} public text URLs; conservative cap estimate $${conservativeCostUsd.toFixed(4)}`,
);

const results = [];
let actualCostUsd = 0;
let unavailableReason: string | null = null;
for (const fixture of fixtures) {
  if (unavailableReason) {
    results.push({
      id: fixture.id,
      sourceUrl: fixture.sourceUrl,
      model: "gemini-3.5-flash-lite",
      capturedAt: new Date().toISOString(),
      retrievals: [],
      usage: null,
      costUsd: 0,
      recipe: null,
      evaluation: null,
      error: `skipped after Gemini became unavailable: ${unavailableReason}`,
    });
    continue;
  }
  process.stdout.write(`gemini-url-context ${fixture.id} ... `);
  try {
    const response = await callGeminiUrlContext(
      fixture.sourceUrl,
      recipeSchema as Record<string, unknown>,
    );
    const evaluated = parseAndEvaluate(response.outputText, fixture.recipe);
    const costUsd = geminiUrlContextCostUsd(response.usage);
    actualCostUsd += costUsd;
    if (actualCostUsd > COST_CAP_USD) {
      throw new Error(`actual URL Context cost exceeded $${COST_CAP_USD} cap`);
    }
    await fs.writeFile(
      path.join(artifactsDirectory, `${fixture.id}.json`),
      `${JSON.stringify(response.rawResponse, null, 2)}\n`,
    );
    results.push({
      id: fixture.id,
      sourceUrl: fixture.sourceUrl,
      model: response.model,
      capturedAt: new Date().toISOString(),
      elapsedMs: response.elapsedMs,
      requestId: response.requestId,
      retrievals: response.retrievals,
      usage: response.usage,
      costUsd,
      recipe: evaluated.recipe,
      evaluation: evaluated.evaluation,
      error: null,
    });
    console.log(
      `retrieved=${response.retrievals.map(({ status }) => status).join(",")} schema=${evaluated.evaluation.schemaSuccess}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /(insufficient|credits? (?:are )?(?:depleted|remaining)|balance|quota)/i.test(
        message,
      )
    ) {
      unavailableReason = message;
    }
    results.push({
      id: fixture.id,
      sourceUrl: fixture.sourceUrl,
      model: "gemini-3.5-flash-lite",
      capturedAt: new Date().toISOString(),
      retrievals: [],
      usage: null,
      costUsd: 0,
      recipe: null,
      evaluation: null,
      error: message,
    });
    console.log(`ERROR ${message.slice(0, 240)}`);
  }
}

const completed = results.filter(
  ({ evaluation }) => evaluation !== null,
).length;
await fs.writeFile(
  resultsPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      architecture: "Gemini Generate Content API with URL Context",
      model: "gemini-3.5-flash-lite",
      excluded: {
        youtube:
          "Gemini URL Context official limitations list YouTube videos as unsupported",
      },
      costCapUsd: COST_CAP_USD,
      conservativeCostUsd,
      actualCostUsd,
      completed,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `completed: ${completed}/${fixtures.length}, estimated actual cost $${actualCostUsd.toFixed(6)}`,
);
if (completed !== fixtures.length) process.exitCode = 1;
