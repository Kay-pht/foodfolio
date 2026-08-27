import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import expectedFixtures from "./results/expected.json" with { type: "json" };
import recipeSchema from "../shared/recipe-schema.json" with { type: "json" };
import { parseAndEvaluate } from "./evaluate.js";
import { aggregateByProvider, selectProvider } from "./aggregate.js";
import {
  PROVIDERS,
  callProvider,
  conservativePlannedCostUsd,
  costUsd,
} from "./providers.js";
import type { ExpectedFixture, ProviderName } from "./types.js";
import type { UrlExtractionResult } from "../url-extraction/types.js";

const COST_CAP_USD = 5;
const root = process.cwd();
const artifactsDirectory = path.join(root, "poc/artifacts/ai-extraction");
const resultsDirectory = path.join(root, "poc/results");
const providers = Object.keys(PROVIDERS) as ProviderName[];

async function readSourceText(id: string): Promise<string> {
  const raw = await fs.readFile(
    path.join(root, "poc/artifacts/url-extraction", `${id}.json`),
    "utf8",
  );
  const extraction = JSON.parse(raw) as UrlExtractionResult;
  if (!extraction.aiInput.usable) {
    throw new Error(`${id} is not AI-usable: ${extraction.aiInput.reason}`);
  }
  return extraction.aiInput.text;
}

await fs.mkdir(artifactsDirectory, { recursive: true });
await fs.mkdir(resultsDirectory, { recursive: true });

const fixtures = expectedFixtures as ExpectedFixture[];
const inputs = await Promise.all(
  fixtures.map(async (fixture) => ({
    fixture,
    sourceText: await readSourceText(fixture.id),
  })),
);
const plannedCostUsd = inputs.reduce(
  (total, { sourceText }) =>
    total +
    providers.reduce(
      (providerTotal, provider) =>
        providerTotal + conservativePlannedCostUsd(provider, sourceText.length),
      0,
    ),
  0,
);
if (plannedCostUsd > COST_CAP_USD) {
  throw new Error(
    `planned conservative API cost $${plannedCostUsd.toFixed(4)} exceeds $${COST_CAP_USD} cap`,
  );
}
console.log(
  `planned: ${fixtures.length} fixtures x ${providers.length} providers; conservative cap estimate $${plannedCostUsd.toFixed(4)}`,
);

const results = [];
let actualCostUsd = 0;
const unavailableProviders = new Map<ProviderName, string>();
for (const { fixture, sourceText } of inputs) {
  for (const provider of providers) {
    if (actualCostUsd >= COST_CAP_USD) {
      throw new Error(`actual API cost reached $${COST_CAP_USD} cap`);
    }
    const unavailableReason = unavailableProviders.get(provider);
    if (unavailableReason) {
      results.push({
        id: fixture.id,
        sourceUrl: fixture.sourceUrl,
        sourceTextSha256: createHash("sha256").update(sourceText).digest("hex"),
        sourceTextLength: sourceText.length,
        provider,
        model: PROVIDERS[provider].model,
        capturedAt: new Date().toISOString(),
        elapsedMs: null,
        requestId: null,
        usage: null,
        costUsd: 0,
        recipe: null,
        evaluation: null,
        error: `skipped after provider became unavailable: ${unavailableReason}`,
      });
      continue;
    }
    process.stdout.write(`${provider} ${fixture.id} ... `);
    try {
      const response = await callProvider(
        provider,
        sourceText,
        recipeSchema as Record<string, unknown>,
      );
      const cost = costUsd(provider, response.usage);
      actualCostUsd += cost;
      const { recipe, evaluation } = parseAndEvaluate(
        response.outputText,
        fixture.recipe,
      );
      await fs.writeFile(
        path.join(artifactsDirectory, `${provider}-${fixture.id}.json`),
        `${JSON.stringify(response.rawResponse, null, 2)}\n`,
      );
      results.push({
        id: fixture.id,
        sourceUrl: fixture.sourceUrl,
        sourceTextSha256: createHash("sha256").update(sourceText).digest("hex"),
        sourceTextLength: sourceText.length,
        provider,
        model: response.model,
        capturedAt: new Date().toISOString(),
        elapsedMs: response.elapsedMs,
        requestId: response.requestId,
        usage: response.usage,
        costUsd: cost,
        recipe,
        evaluation,
        error: null,
      });
      console.log(
        `schema=${evaluation.schemaSuccess} hallucinations=${evaluation.hallucinationCount} $${cost.toFixed(6)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /(insufficient|credits? (?:are )?(?:depleted|remaining)|balance|quota)/i.test(
          message,
        )
      ) {
        unavailableProviders.set(provider, message);
      }
      results.push({
        id: fixture.id,
        sourceUrl: fixture.sourceUrl,
        sourceTextSha256: createHash("sha256").update(sourceText).digest("hex"),
        sourceTextLength: sourceText.length,
        provider,
        model: PROVIDERS[provider].model,
        capturedAt: new Date().toISOString(),
        elapsedMs: null,
        requestId: null,
        usage: null,
        costUsd: 0,
        recipe: null,
        evaluation: null,
        error: message,
      });
      console.log(`ERROR ${message.slice(0, 240)}`);
    }
  }
}

const providerMetrics = aggregateByProvider(results);
const selectedProvider = selectProvider(providerMetrics);

await fs.writeFile(
  path.join(resultsDirectory, "ai-comparison-results.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      costCapUsd: COST_CAP_USD,
      conservativePlannedCostUsd: plannedCostUsd,
      actualCostUsd,
      providerConfiguration: PROVIDERS,
      acceptanceCriteria: {
        jsonParseSuccessRate: 1,
        schemaSuccessRate: 1,
        hallucinationCount: 0,
        ingredientPrecision: 0.9,
        ingredientRecall: 0.9,
        ingredientAmountExactRate: 0.85,
        titleMatchRate: 0.9,
        servingsMatchRate: 0.9,
        cookingTimeMatchRate: 0.9,
        genreMatchRate: 0.9,
        stepPrecision: 0.9,
        stepRecall: 0.9,
      },
      providerMetrics,
      selectedProvider,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `completed: ${results.length} calls, estimated actual cost $${actualCostUsd.toFixed(6)}`,
);
if (!selectedProvider) process.exitCode = 1;
