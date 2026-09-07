import { appendFile } from "node:fs/promises";

const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";
const REUSABLE_QUALITY_EVENTS = new Set(["pull_request", "workflow_dispatch"]);

export function isReusableQualityRun(run, repository) {
  return (
    run.conclusion === "success" &&
    REUSABLE_QUALITY_EVENTS.has(run.event) &&
    run.name === "Quality" &&
    run.path === QUALITY_WORKFLOW_PATH &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository
  );
}

async function githubApi(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${path}`);
  }

  return response.json();
}

export async function findReusableQualityRunId({
  repository,
  token,
  treeSha,
  api = githubApi,
}) {
  const artifactName = `quality-proof-${treeSha}`;
  const response = await api(
    `/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`,
    token,
  );
  const artifacts = [...(response.artifacts ?? [])]
    .filter((artifact) => artifact.name === artifactName && !artifact.expired)
    .sort((left, right) => right.id - left.id);

  for (const artifact of artifacts) {
    const runId = artifact.workflow_run?.id;
    if (!Number.isSafeInteger(runId)) {
      continue;
    }

    const run = await api(`/repos/${repository}/actions/runs/${runId}`, token);
    if (isReusableQualityRun(run, repository)) {
      return runId;
    }
  }

  return undefined;
}

async function writeOutput(reusable, runId) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }

  const lines = [`reusable=${reusable}`];
  if (runId !== undefined) {
    lines.push(`run-id=${runId}`);
  }
  await appendFile(outputPath, `${lines.join("\n")}\n`);
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const treeSha = process.env.QUALITY_TREE_SHA;

  if (!repository || !token || !treeSha) {
    throw new Error(
      "GITHUB_REPOSITORY, GH_TOKEN, and QUALITY_TREE_SHA are required",
    );
  }
  if (!/^[0-9a-f]{40,64}$/.test(treeSha)) {
    throw new Error("QUALITY_TREE_SHA must be a Git object ID");
  }

  try {
    const runId = await findReusableQualityRunId({
      repository,
      token,
      treeSha,
    });
    await writeOutput(runId !== undefined, runId);
    if (runId !== undefined) {
      console.log(`Reusing successful Quality run ${runId}.`);
    } else {
      console.log("No reusable Quality proof found; running full Quality.");
    }
  } catch (error) {
    console.warn(
      `Could not verify a reusable Quality proof; running full Quality. ${error instanceof Error ? error.message : String(error)}`,
    );
    await writeOutput(false);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
