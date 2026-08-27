import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import cases from "./cases.json" with { type: "json" };
import { classifySources } from "./classify.js";
import { extractUrl } from "./extract.js";
import type { UrlCase } from "./types.js";

const root = process.cwd();
const rawDirectory = path.join(root, "poc/artifacts/url-extraction");
const summaryDirectory = path.join(root, "poc/results");

await fs.mkdir(rawDirectory, { recursive: true });
await fs.mkdir(summaryDirectory, { recursive: true });

const results = [];
for (const testCase of cases as UrlCase[]) {
  process.stdout.write(`fetch ${testCase.id} ... `);
  const result = await extractUrl(testCase);
  results.push(result);
  await fs.writeFile(
    path.join(rawDirectory, `${testCase.id}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `${result.http.status} usable=${result.aiInput.usable} methods=${result.evidence.extractionMethods.join(",")}`,
  );
}

const committedSummary = results.map(({ aiInput, ...result }) => ({
  ...result,
  aiInput: {
    usable: aiInput.usable,
    reason: aiInput.reason,
    textSha256: createHash("sha256").update(aiInput.text).digest("hex"),
    textLength: aiInput.text.length,
  },
}));

await fs.writeFile(
  path.join(summaryDirectory, "url-extraction-summary.json"),
  `${JSON.stringify(committedSummary, null, 2)}\n`,
);

await fs.writeFile(
  path.join(summaryDirectory, "url-source-classification.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      criteria: {
        available: "3/3 recipe URLs produce AI-usable text",
        conditional: "1-2/3 recipe URLs produce AI-usable text",
        unsupported: "0/3 recipe URLs produce AI-usable text",
        imagePolicy: "image failure alone does not fail text acquisition",
      },
      sources: classifySources(results),
    },
    null,
    2,
  )}\n`,
);

const usable = results.filter((result) => result.aiInput.usable).length;
console.log(`\ncompleted: ${results.length} cases, ${usable} AI-usable`);
