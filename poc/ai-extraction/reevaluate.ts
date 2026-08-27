import fs from "node:fs/promises";
import path from "node:path";
import expectedFixtures from "./results/expected.json" with { type: "json" };
import { aggregateByProvider, selectProvider } from "./aggregate.js";
import { parseAndEvaluate } from "./evaluate.js";
import type {
  Evaluation,
  ExpectedFixture,
  ProviderName,
  Recipe,
} from "./types.js";

interface StoredResult {
  id: string;
  provider: ProviderName;
  model: string;
  elapsedMs: number | null;
  costUsd: number;
  recipe: Recipe | null;
  evaluation: Evaluation | null;
  error: string | null;
  [key: string]: unknown;
}

interface ComparisonFile {
  results: StoredResult[];
  providerMetrics: unknown;
  selectedProvider: unknown;
  [key: string]: unknown;
}

const resultPath = path.join(
  process.cwd(),
  "poc/results/ai-comparison-results.json",
);
const comparison = JSON.parse(
  await fs.readFile(resultPath, "utf8"),
) as ComparisonFile;
const expectedById = new Map(
  (expectedFixtures as ExpectedFixture[]).map((fixture) => [
    fixture.id,
    fixture,
  ]),
);

const results = comparison.results.map((row) => {
  if (!row.recipe || row.error) return row;
  const expected = expectedById.get(row.id);
  if (!expected) throw new Error(`expected fixture not found: ${row.id}`);
  const { evaluation } = parseAndEvaluate(
    JSON.stringify(row.recipe),
    expected.recipe,
  );
  return { ...row, evaluation };
});
const providerMetrics = aggregateByProvider(results);
const selectedProvider = selectProvider(providerMetrics);

await fs.writeFile(
  resultPath,
  `${JSON.stringify(
    {
      ...comparison,
      reevaluatedAt: new Date().toISOString(),
      providerMetrics,
      selectedProvider,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ providerMetrics, selectedProvider }, null, 2));
if (!selectedProvider) process.exitCode = 1;
