import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import cases from "../url-extraction/cases.json" with { type: "json" };
import {
  callYoutube,
  fetchYoutubeDescription,
  inspectYoutubeResponse,
  verifyFreeBilling,
  YOUTUBE_POC_MODEL,
} from "./gemini-youtube.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
const withDescription = process.argv.includes("--with-description");
const youtubeKey = process.env.YOUTUBE_API_KEY;
if (withDescription && !youtubeKey)
  throw new Error("YOUTUBE_API_KEY is not set");
const accessToken = execFileSync(
  "gcloud",
  ["auth", "print-access-token", "--account", "kei.patheng@gmail.com"],
  { encoding: "utf8" },
).trim();
const billing = await verifyFreeBilling(apiKey, accessToken);
const runId = new Date().toISOString().replaceAll(":", "-");
const directory = `poc/artifacts/gemini-youtube/${runId}`;
await fs.mkdir(directory, { recursive: true });
const selected = cases.filter(
  (c) => c.source === "youtube" && c.kind === "recipe",
);
const results: unknown[] = [];
let stopped = false;
for (const item of selected) {
  if (stopped) {
    results.push({
      id: item.id,
      url: item.url,
      status: "not_attempted_after_failure",
    });
    continue;
  }
  try {
    const metadata = withDescription
      ? await fetchYoutubeDescription(item.url, youtubeKey!)
      : undefined;
    if (metadata)
      await fs.writeFile(
        `${directory}/${item.id}-input.json`,
        JSON.stringify(metadata, null, 2),
      );
    // Recheck immediately before every generation; never enable billing or retry.
    await verifyFreeBilling(apiKey, accessToken);
    const response = await callYoutube(
      item.url,
      apiKey,
      fetch,
      metadata?.description,
    );
    await fs.writeFile(
      `${directory}/${item.id}.json`,
      JSON.stringify(response, null, 2),
    );
    const success = response.httpStatus >= 200 && response.httpStatus < 300;
    const result = {
      id: item.id,
      url: item.url,
      httpStatus: response.httpStatus,
      elapsedMs: response.elapsedMs,
      descriptionEvidence: metadata
        ? {
            source: metadata.source,
            fetchedAt: metadata.fetchedAt,
            characters: metadata.description.length,
            sha256: createHash("sha256")
              .update(metadata.description)
              .digest("hex"),
          }
        : null,
      ...(success
        ? inspectYoutubeResponse(response.raw)
        : { error: response.raw }),
    };
    results.push(result);
    console.log(JSON.stringify(result));
    stopped = !success;
  } catch {
    // Avoid logging exception messages that could contain credential-bearing URLs.
    results.push({
      id: item.id,
      url: item.url,
      status: "transport_metadata_or_billing_check_failed",
    });
    stopped = true;
  }
}
const report = {
  runId,
  mode: withDescription ? "video-and-description" : "video-only",
  model: YOUTUBE_POC_MODEL,
  billing,
  stopped,
  results,
};
await fs.mkdir("poc/results", { recursive: true });
const reportPath = `poc/results/gemini-youtube-${runId}.json`;
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Report: ${reportPath}`);
if (stopped) process.exitCode = 1;
