import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const ZERO_SHA_PATTERN = /^0+$/;
const IOS_PATHS = new Set([
  ".swift-format",
  "scripts/lint-ios.sh",
  "scripts/push-simulator-notification.sh",
  "scripts/test-ios.sh",
  "scripts/verify-ios.sh",
]);

function normalizePath(path) {
  return path.replace(/^\.\/+/, "");
}

function isDocumentationPath(path) {
  return path === "todo.md" || path.endsWith(".md") || path.startsWith("docs/");
}

function isIosPath(path) {
  return path.startsWith("ios/") || IOS_PATHS.has(path);
}

export function classifyQualityPaths(paths) {
  let backend = false;
  let ios = false;

  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (!path) {
      continue;
    }
    if (isIosPath(path)) {
      ios = true;
      continue;
    }
    if (isDocumentationPath(path)) {
      continue;
    }

    // Treat every unknown or shared path as backend-affecting. This fails safe
    // when new repository-level configuration or source directories are added.
    backend = true;
  }

  return { backend, ios };
}

async function changedPaths(baseSha, headSha) {
  const { stdout } = await execFileAsync("git", [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    baseSha,
    headSha,
    "--",
  ]);
  return stdout.split("\n").filter(Boolean);
}

async function writeOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  await appendFile(
    outputPath,
    `backend=${result.backend}\nios=${result.ios}\n`,
  );
}

async function main() {
  const baseSha = process.env.QUALITY_BASE_SHA;
  const headSha = process.env.QUALITY_HEAD_SHA;

  try {
    if (
      !baseSha ||
      !headSha ||
      !GIT_SHA_PATTERN.test(baseSha) ||
      !GIT_SHA_PATTERN.test(headSha) ||
      ZERO_SHA_PATTERN.test(baseSha) ||
      ZERO_SHA_PATTERN.test(headSha)
    ) {
      throw new Error(
        "QUALITY_BASE_SHA and QUALITY_HEAD_SHA must be Git object IDs",
      );
    }

    const paths = await changedPaths(baseSha, headSha);
    const result = classifyQualityPaths(paths);
    console.log(
      `Changed paths: ${paths.length}; backend=${result.backend}; ios=${result.ios}.`,
    );
    await writeOutput(result);
  } catch (error) {
    console.warn(
      `Could not classify Quality changes; running backend and iOS checks safely. ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeOutput({ backend: true, ios: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
