import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEPLOY_PATHS = [
  "Dockerfile",
  "package.json",
  "package-lock.json",
  "prisma",
  "schemas",
  "src",
];
const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const ZERO_SHA_PATTERN = /^0+$/;

async function runGit(args) {
  try {
    await execFileAsync("git", args);
    return 0;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
    ) {
      return error.code;
    }
    throw error;
  }
}

export async function classifyDeploymentRange({
  beforeSha,
  afterSha,
  expectedAfterSha,
  git = runGit,
}) {
  if (
    !GIT_SHA_PATTERN.test(beforeSha) ||
    !GIT_SHA_PATTERN.test(afterSha) ||
    afterSha !== expectedAfterSha ||
    ZERO_SHA_PATTERN.test(beforeSha)
  ) {
    return { deploy: true, reason: "invalid or mismatched push range" };
  }

  const isAncestor = await git([
    "merge-base",
    "--is-ancestor",
    beforeSha,
    afterSha,
  ]);
  if (isAncestor !== 0) {
    return { deploy: true, reason: "push range is not a known ancestry path" };
  }

  const diff = await git([
    "diff",
    "--quiet",
    beforeSha,
    afterSha,
    "--",
    ...DEPLOY_PATHS,
  ]);
  if (diff === 0) {
    return { deploy: false, reason: "push range has no deployable changes" };
  }
  if (diff === 1) {
    return { deploy: true, reason: "push range has deployable changes" };
  }
  return { deploy: true, reason: `git diff failed with exit code ${diff}` };
}

async function writeOutput(deploy) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  await appendFile(outputPath, `deploy=${deploy}\n`);
}

async function main() {
  try {
    const contextPath = process.env.PUSH_CONTEXT_PATH;
    const expectedAfterSha = process.env.DEPLOY_SHA;
    if (!contextPath || !expectedAfterSha) {
      throw new Error("PUSH_CONTEXT_PATH and DEPLOY_SHA are required");
    }

    const context = JSON.parse(await readFile(contextPath, "utf8"));
    const result = await classifyDeploymentRange({
      beforeSha: context.before,
      afterSha: context.after,
      expectedAfterSha,
    });
    console.log(`${result.reason}; deploy=${result.deploy}.`);
    await writeOutput(result.deploy);
  } catch (error) {
    console.warn(
      `Could not verify the complete push range; deploying safely. ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeOutput(true);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
