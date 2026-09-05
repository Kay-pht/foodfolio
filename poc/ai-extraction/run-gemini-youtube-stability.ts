import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import baseline from "../results/gemini-youtube-2026-09-05T02-16-35.383Z.json" with { type: "json" };
import {
  callYoutube,
  fetchYoutubeDescription,
  inspectYoutubeResponse,
  verifyFreeBilling,
  YOUTUBE_POC_MODEL,
} from "./gemini-youtube.js";

const apiKey = process.env.GEMINI_API_KEY;
const stabilizeUnknowns = process.argv.includes("--stabilize-unknowns");
if (!apiKey) throw new Error("GEMINI_API_KEY missing");
const youtubeApiKey = process.env.YOUTUBE_API_KEY;
if (!youtubeApiKey) throw new Error("YOUTUBE_API_KEY missing");
const token = execFileSync(
  "gcloud",
  ["auth", "print-access-token", "--account", "kei.patheng@gmail.com"],
  { encoding: "utf8" },
).trim();
const runId = new Date().toISOString().replaceAll(":", "-");
const directory = `poc/artifacts/gemini-youtube/${runId}`;
await fs.mkdir(directory, { recursive: true });
const inputs = await Promise.all(
  baseline.results.map(async (item) => {
    const metadata = await fetchYoutubeDescription(item.url, youtubeApiKey);
    const hash = createHash("sha256")
      .update(metadata.description)
      .digest("hex");
    if (hash !== item.descriptionEvidence.sha256)
      throw new Error(
        `Current YouTube description differs from the fixed baseline: ${item.id}`,
      );
    return { ...item, description: metadata.description };
  }),
);
const estimatedBatchTokens = Math.ceil(
  inputs.reduce((sum, item) => sum + item.usageMetadata.promptTokenCount, 0) *
    1.25,
);
if (estimatedBatchTokens > 200_000)
  throw new Error("Planned batch exceeds conservative token budget");
const report = {
  runId,
  model: YOUTUBE_POC_MODEL,
  mode: stabilizeUnknowns
    ? "video-description-optional-unknowns-v2"
    : "video-description-ingredient-audit-v1",
  inputRunId: baseline.runId,
  estimatedBatchTokens,
  maxCalls: 9,
  batchCooldownMs: 65_000,
  residualProjectQuota: "unknown",
  results: [] as unknown[],
  stopped: false,
};
const save = () =>
  fs.writeFile(
    `poc/results/gemini-youtube-stability-${runId}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
await save();
for (let repeat = 1; repeat <= 3 && !report.stopped; repeat++) {
  if (repeat > 1) {
    console.log("Cooling down 65 seconds after the previous batch");
    await delay(30_000);
    await delay(30_000);
    await delay(5_000);
  }
  let batchTokens = 0;
  for (const item of inputs) {
    try {
      const billing = await verifyFreeBilling(apiKey, token);
      const response = await callYoutube(
        item.url,
        apiKey,
        fetch,
        item.description,
        true,
        stabilizeUnknowns,
      );
      await fs.writeFile(
        `${directory}/${item.id}-${repeat}.json`,
        JSON.stringify(response, null, 2),
      );
      const ok = response.httpStatus >= 200 && response.httpStatus < 300;
      const inspected = ok ? inspectYoutubeResponse(response.raw) : null;
      const result = {
        id: item.id,
        url: item.url,
        repeat,
        billing,
        httpStatus: response.httpStatus,
        elapsedMs: response.elapsedMs,
        descriptionSha256: item.descriptionEvidence.sha256,
        ...(inspected ?? { error: response.raw }),
      };
      report.results.push(result);
      console.log(JSON.stringify(result));
      batchTokens +=
        (inspected?.usageMetadata as { promptTokenCount?: number } | null)
          ?.promptTokenCount ?? 0;
      report.stopped =
        !ok ||
        !inspected?.nonemptyRecipe ||
        inspected.finishReason !== "STOP" ||
        batchTokens > 200_000;
      await save();
      if (report.stopped) break;
    } catch {
      report.results.push({
        id: item.id,
        repeat,
        status: "request_or_billing_failed",
      });
      report.stopped = true;
      await save();
      break;
    }
  }
}
console.log(`Report: poc/results/gemini-youtube-stability-${runId}.json`);
if (report.stopped) process.exitCode = 1;
