import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  classifyInstagramMedia,
  parseYtDlpInstagramJson,
  validatePocCases,
  type ExpectedInstagramCase,
  type MediaAsset,
  type PocCase,
} from "./manifest.js";

const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const DEFAULT_CASES = "poc/instagram-media/cases.json";
const DEFAULT_TIMEOUT_MS = 60_000;
const REQUIRED_DECISION_KINDS: ExpectedInstagramCase[] = [
  "reel",
  "video",
  "image",
  "image-carousel",
  "mixed-carousel",
];

type CaseOutcome = "pass" | "fail" | "inconclusive";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface DownloadResult {
  index: number;
  kind: MediaAsset["kind"];
  ok: boolean;
  bytes: number;
  contentType: string | null;
  fileName: string | null;
  error: string | null;
}

interface CaseResult {
  id: string;
  url: string;
  expectedKind: PocCase["expectedKind"];
  actualKind: ReturnType<typeof classifyInstagramMedia>;
  mode: PocCase["mode"];
  source?: string;
  note?: string;
  metadataOk: boolean;
  assetCount: number;
  unavailableEntryCount: number;
  downloads: DownloadResult[];
  outcome: CaseOutcome;
  error: string | null;
  diagnostic: string | null;
  attempts: number;
}

function parseArgs(argv: string[]): { casesPath: string } {
  let casesPath = DEFAULT_CASES;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases") {
      const next = argv[index + 1];
      if (!next) throw new Error("--cases requires a path");
      casesPath = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { casesPath };
}

function positiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function runCommand(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolveCommand({
        code: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolveCommand({ code, stdout, stderr, timedOut });
    });
  });
}

function safeDiagnostic(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12);
  return lines.length ? lines.join("\n") : null;
}

function extensionFor(contentType: string | null, asset: MediaAsset): string {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  const pathnameExtension = extname(new URL(asset.url).pathname);
  return pathnameExtension && pathnameExtension.length <= 8
    ? pathnameExtension
    : asset.kind === "video"
      ? ".mp4"
      : ".img";
}

async function downloadAsset(
  asset: MediaAsset,
  caseDirectory: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadResult> {
  try {
    const response = await fetchImpl(asset.url, {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
        ...asset.httpHeaders,
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > MAX_MEDIA_BYTES)
      throw new Error(`media exceeds ${MAX_MEDIA_BYTES} bytes`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1) throw new Error("downloaded media is empty");
    if (bytes.byteLength > MAX_MEDIA_BYTES)
      throw new Error(`media exceeds ${MAX_MEDIA_BYTES} bytes`);
    const contentType = response.headers.get("content-type");
    const fileName = `${String(asset.index).padStart(2, "0")}-${asset.kind}${extensionFor(contentType, asset)}`;
    await writeFile(join(caseDirectory, fileName), bytes);
    return {
      index: asset.index,
      kind: asset.kind,
      ok: true,
      bytes: bytes.byteLength,
      contentType,
      fileName,
      error: null,
    };
  } catch (error) {
    return {
      index: asset.index,
      kind: asset.kind,
      ok: false,
      bytes: 0,
      contentType: null,
      fileName: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function failedCase(
  item: PocCase,
  attempts: number,
  diagnostic: string | null,
): CaseResult {
  return {
    id: item.id,
    url: item.url,
    expectedKind: item.expectedKind,
    actualKind: "unknown",
    mode: item.mode,
    ...(item.source ? { source: item.source } : {}),
    ...(item.note ? { note: item.note } : {}),
    metadataOk: false,
    assetCount: 0,
    unavailableEntryCount: 0,
    downloads: [],
    outcome: item.mode === "probe" ? "inconclusive" : "fail",
    error: `yt-dlp metadata extraction failed after ${attempts} attempt(s)`,
    diagnostic,
    attempts,
  };
}

async function runCase(
  item: PocCase,
  outputRoot: string,
  ytDlp: string,
  maxAttempts: number,
): Promise<CaseResult> {
  const caseDirectory = join(outputRoot, item.id);
  await mkdir(caseDirectory, { recursive: true });
  let lastDiagnostic: string | null = null;
  let lastPartialResult: CaseResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const command = await runCommand(
      ytDlp,
      [
        "--dump-single-json",
        "--skip-download",
        "--ignore-no-formats-error",
        "--no-progress",
        "--yes-playlist",
        item.url,
      ],
      DEFAULT_TIMEOUT_MS,
    );
    lastDiagnostic = safeDiagnostic(command.stderr);

    if (command.code === 0 && command.stdout.trim()) {
      try {
        const raw = JSON.parse(command.stdout) as unknown;
        await writeFile(
          join(caseDirectory, "yt-dlp.json"),
          `${JSON.stringify(raw, null, 2)}\n`,
        );
        const parsed = parseYtDlpInstagramJson(raw);
        const actualKind = classifyInstagramMedia(item.url, parsed);
        const downloads = await Promise.all(
          parsed.assets.map((asset) => downloadAsset(asset, caseDirectory)),
        );
        const retrievalOk =
          parsed.unavailableEntryCount === 0 &&
          parsed.assets.length > 0 &&
          downloads.every((download) => download.ok);
        const assertionSatisfied =
          retrievalOk && actualKind === item.expectedKind;
        const outcome: CaseOutcome =
          item.mode === "probe"
            ? "inconclusive"
            : assertionSatisfied
              ? "pass"
              : "fail";
        const result: CaseResult = {
          id: item.id,
          url: item.url,
          expectedKind: item.expectedKind,
          actualKind,
          mode: item.mode,
          ...(item.source ? { source: item.source } : {}),
          ...(item.note ? { note: item.note } : {}),
          metadataOk: true,
          assetCount: parsed.assets.length,
          unavailableEntryCount: parsed.unavailableEntryCount,
          downloads,
          outcome,
          error:
            retrievalOk && (item.mode === "probe" || assertionSatisfied)
              ? null
              : "metadata was readable but did not satisfy the expected media/download conditions",
          diagnostic: lastDiagnostic,
          attempts: attempt,
        };

        if (assertionSatisfied) return result;
        if (item.mode === "probe" && retrievalOk) return result;
        lastPartialResult = result;
      } catch (error) {
        lastDiagnostic = error instanceof Error ? error.message : String(error);
      }
    }

    if (attempt < maxAttempts) await delay(Math.min(attempt * 2, 10) * 1000);
  }

  return lastPartialResult ?? failedCase(item, maxAttempts, lastDiagnostic);
}

function missingDecisionKinds(results: CaseResult[]): ExpectedInstagramCase[] {
  return REQUIRED_DECISION_KINDS.filter(
    (kind) =>
      !results.some(
        (result) =>
          result.mode === "assert" &&
          result.expectedKind === kind &&
          result.outcome === "pass",
      ),
  );
}

function markdownReport(
  version: string,
  maxAttempts: number,
  results: CaseResult[],
): string {
  const passed = results.filter((result) => result.outcome === "pass").length;
  const failed = results.filter((result) => result.outcome === "fail").length;
  const inconclusive = results.filter(
    (result) => result.outcome === "inconclusive",
  ).length;
  const missingKinds = missingDecisionKinds(results);
  const lines = [
    "# Instagram Media PoC result",
    "",
    `- yt-dlp: \`${version}\``,
    `- max attempts per case: ${maxAttempts}`,
    `- asserted PASS: ${passed}`,
    `- asserted FAIL: ${failed}`,
    `- INCONCLUSIVE probes: ${inconclusive}`,
    `- missing production-decision coverage: ${missingKinds.length ? missingKinds.join(", ") : "none"}`,
    "",
    "| Case | Mode | Expected | Actual | Assets | Downloads | Attempts | Outcome |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.mode} | ${result.expectedKind} | ${result.actualKind} | ${result.assetCount} | ${result.downloads.filter((download) => download.ok).length}/${result.downloads.length} | ${result.attempts} | ${result.outcome.toUpperCase()} |`,
    ),
    "",
    "## Diagnostics",
    "",
  ];
  for (const result of results) {
    lines.push(`### ${result.id}`, "");
    lines.push(`- mode: ${result.mode}`);
    lines.push(`- outcome: ${result.outcome.toUpperCase()}`);
    lines.push(result.error ? `- error: ${result.error}` : "- error: none");
    lines.push(`- attempts: ${result.attempts}`);
    lines.push(`- unavailable entries: ${result.unavailableEntryCount}`);
    if (result.note) lines.push(`- note: ${result.note}`);
    if (result.diagnostic) lines.push("", "```text", result.diagnostic, "```");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { casesPath } = parseArgs(process.argv.slice(2));
  const maxAttempts = positiveInteger(
    "INSTAGRAM_POC_MAX_ATTEMPTS",
    process.env.INSTAGRAM_POC_MAX_ATTEMPTS,
    3,
  );
  const ytDlp = process.env.YT_DLP_BIN?.trim() || "yt-dlp";
  const versionResult = await runCommand(ytDlp, ["--version"], 10_000);
  if (versionResult.code !== 0)
    throw new Error(
      `yt-dlp is unavailable: ${safeDiagnostic(versionResult.stderr) ?? "unknown error"}`,
    );
  const version = versionResult.stdout.trim();
  const rawCases = JSON.parse(
    await readFile(resolve(casesPath), "utf8"),
  ) as unknown;
  const cases = validatePocCases(rawCases);
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const outputRoot = resolve(
    process.env.INSTAGRAM_POC_OUTPUT_DIR?.trim() ||
      join("poc", "artifacts", "instagram-media", timestamp),
  );
  await mkdir(outputRoot, { recursive: true });

  console.log(`yt-dlp: ${version}`);
  console.log(`cases: ${cases.length}`);
  console.log(`output: ${outputRoot}`);
  console.log(`max attempts per case: ${maxAttempts}`);

  const results: CaseResult[] = [];
  for (const item of cases) {
    console.log(
      `\n== ${item.id}: mode=${item.mode}, expected ${item.expectedKind} ==`,
    );
    const result = await runCase(item, outputRoot, ytDlp, maxAttempts);
    results.push(result);
    console.log(
      `${result.outcome.toUpperCase()}: actual=${result.actualKind}, assets=${result.assetCount}, downloads=${result.downloads.filter((download) => download.ok).length}/${result.downloads.length}, attempts=${result.attempts}`,
    );
  }

  const missingKinds = missingDecisionKinds(results);
  await writeFile(
    join(outputRoot, "result.json"),
    `${JSON.stringify({ version, maxAttempts, missingDecisionKinds: missingKinds, results }, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "result.md"),
    markdownReport(version, maxAttempts, results),
  );

  const failed = results.filter((result) => result.outcome === "fail");
  if (failed.length > 0) {
    console.error(`\nPoC FAILED: ${failed.length} asserted case(s) failed.`);
    console.error(`Inspect ${join(outputRoot, "result.md")}`);
    process.exitCode = 1;
    return;
  }
  if (missingKinds.length > 0) {
    console.error(
      `\nPoC INCONCLUSIVE: replace probe/stale samples for ${missingKinds.join(", ")} with current public recipe URLs and rerun.`,
    );
    console.error(`Inspect ${join(outputRoot, "result.md")}`);
    process.exitCode = 2;
    return;
  }

  console.log(
    "\nPoC SUCCESS: all production-decision media kinds passed asserted cases.",
  );
  console.log(`Result: ${join(outputRoot, "result.md")}`);
}

await main();
