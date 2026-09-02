import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
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
  deployedSha,
  targetSha,
  git = runGit,
}) {
  if (
    !GIT_SHA_PATTERN.test(deployedSha) ||
    !GIT_SHA_PATTERN.test(targetSha) ||
    ZERO_SHA_PATTERN.test(deployedSha)
  ) {
    return { deploy: true, reason: "deployed or target SHA is unavailable" };
  }

  const isAncestor = await git([
    "merge-base",
    "--is-ancestor",
    deployedSha,
    targetSha,
  ]);
  if (isAncestor !== 0) {
    return {
      deploy: true,
      reason: "deployed SHA is not a known ancestor of target SHA",
    };
  }

  const diff = await git([
    "diff",
    "--quiet",
    deployedSha,
    targetSha,
    "--",
    ...DEPLOY_PATHS,
  ]);
  if (diff === 0) {
    return {
      deploy: false,
      reason: "deployed-to-target range has no deployable changes",
    };
  }
  if (diff === 1) {
    return {
      deploy: true,
      reason: "deployed-to-target range has deployable changes",
    };
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
    const deployedSha = process.env.DEPLOYED_SHA;
    const targetSha = process.env.DEPLOY_SHA;
    if (!deployedSha || !targetSha) {
      throw new Error("DEPLOYED_SHA and DEPLOY_SHA are required");
    }

    const result = await classifyDeploymentRange({
      deployedSha,
      targetSha,
    });
    console.log(`${result.reason}; deploy=${result.deploy}.`);
    await writeOutput(result.deploy);
  } catch (error) {
    console.warn(
      `Could not compare deployed and target SHAs; deploying safely. ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeOutput(true);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
