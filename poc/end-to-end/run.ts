import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import cases from "../url-extraction/cases.json" with { type: "json" };
import expectedFixtures from "../ai-extraction/results/expected.json" with { type: "json" };
import { aggregateByProvider } from "../ai-extraction/aggregate.js";
import {
  PROVIDERS,
  conservativePlannedCostUsd,
  costUsd,
} from "../ai-extraction/providers.js";
import type { ExpectedFixture, ProviderName } from "../ai-extraction/types.js";
import type { UrlCase } from "../url-extraction/types.js";
import { runPipeline } from "./pipeline.js";

const REPETITIONS = 3;
const COST_CAP_USD = 5;
const root = process.cwd();
const comparison = JSON.parse(
  await fs.readFile(
    path.join(root, "poc/results/ai-comparison-results.json"),
    "utf8",
  ),
) as { selectedProvider: { provider: ProviderName } | null };
const provider = comparison.selectedProvider?.provider;
if (!provider) {
  throw new Error(
    "no provider passed the AI comparison acceptance criteria; E2E is blocked",
  );
}

const fixtures = expectedFixtures as ExpectedFixture[];
const urlCases = cases as UrlCase[];
const selectedCases = fixtures.map((fixture) => {
  const testCase = urlCases.find(({ id }) => id === fixture.id);
  if (!testCase) throw new Error(`URL case not found: ${fixture.id}`);
  return { fixture, testCase };
});
const conservativeCostUsd = selectedCases.reduce(
  (total) => total + conservativePlannedCostUsd(provider, 18_000) * REPETITIONS,
  0,
);
if (conservativeCostUsd > COST_CAP_USD) {
  throw new Error(
    `conservative E2E cost $${conservativeCostUsd.toFixed(4)} exceeds $${COST_CAP_USD} cap`,
  );
}

const results = [];
let totalCostUsd = 0;
for (const { fixture, testCase } of selectedCases) {
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    process.stdout.write(`${provider} ${fixture.id} run ${repetition} ... `);
    const result = await runPipeline(testCase, fixture, provider);
    const requestCostUsd = costUsd(provider, result.response.usage);
    totalCostUsd += requestCostUsd;
    results.push({
      id: fixture.id,
      sourceUrl: fixture.sourceUrl,
      repetition,
      provider,
      model: result.response.model,
      capturedAt: new Date().toISOString(),
      elapsedMs: result.response.elapsedMs,
      costUsd: requestCostUsd,
      extraction: {
        httpStatus: result.extraction.http.status,
        methods: result.extraction.evidence.extractionMethods,
        textSha256: result.extraction.evidence.textSha256,
      },
      recipe: result.recipe,
      evaluation: result.evaluation,
      error: null,
    });
    console.log(
      `schema=${result.evaluation.schemaSuccess} hallucinations=${result.evaluation.hallucinationCount}`,
    );
  }
}
const metrics = aggregateByProvider(results);
await fs.writeFile(
  path.join(root, "poc/results/e2e-results.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      provider,
      model: PROVIDERS[provider].model,
      repetitions: REPETITIONS,
      conservativeCostUsd,
      totalCostUsd,
      metrics,
      stable: metrics[0]?.passesAcceptance === true,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `completed: ${results.length} real URL E2E calls, $${totalCostUsd.toFixed(6)}`,
);
