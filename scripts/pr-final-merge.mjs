import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml";
const QUALITY_EVENTS = new Set(["pull_request", "workflow_dispatch"]);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
  })?.trim();
}

function ghApi(path) {
  return JSON.parse(run("gh", ["api", path]));
}

function readRepository() {
  return run("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
}

function readPr() {
  return JSON.parse(
    run("gh", ["pr", "view", "--json", "number,headRefOid,state,isDraft"]),
  );
}

export function isSuccessfulQualityRunForPr(
  qualityRun,
  { repository, prNumber, headSha },
) {
  const pullRequest = qualityRun.pull_requests?.find(
    (candidate) => candidate.number === prNumber,
  );

  return (
    qualityRun.status === "completed" &&
    qualityRun.conclusion === "success" &&
    QUALITY_EVENTS.has(qualityRun.event) &&
    qualityRun.name === "Quality" &&
    qualityRun.path === QUALITY_WORKFLOW_PATH &&
    qualityRun.repository?.full_name === repository &&
    pullRequest?.head?.sha === headSha &&
    (qualityRun.event !== "workflow_dispatch" ||
      qualityRun.head_sha === headSha)
  );
}

export function resolveCurrentMergeTree(
  pullRequest,
  mergeCommit,
  expectedHeadSha,
) {
  if (pullRequest.state !== "open" || pullRequest.draft) {
    throw new Error("Pull request is no longer open and ready for merge.");
  }
  if (pullRequest.head?.sha !== expectedHeadSha) {
    throw new Error(
      `PR HEAD changed while resolving merge preview. expected=${expectedHeadSha}, current=${pullRequest.head?.sha ?? "missing"}.`,
    );
  }
  if (!pullRequest.merge_commit_sha) {
    throw new Error(
      "GitHub has not produced a merge preview commit for this PR.",
    );
  }
  if (mergeCommit.sha !== pullRequest.merge_commit_sha) {
    throw new Error(
      "GitHub merge preview commit changed while it was being resolved.",
    );
  }
  if (
    mergeCommit.parents?.[0]?.sha !== pullRequest.base?.sha ||
    mergeCommit.parents?.[1]?.sha !== expectedHeadSha
  ) {
    throw new Error(
      "GitHub merge preview is stale for the current base/head. Retry after GitHub refreshes the PR merge result.",
    );
  }

  const treeSha = mergeCommit.tree?.sha;
  if (!/^[0-9a-f]{40,64}$/.test(treeSha ?? "")) {
    throw new Error("GitHub merge preview does not contain a valid tree SHA.");
  }
  return treeSha;
}

export function findSuccessfulQualityRunId({
  artifacts,
  loadRun,
  repository,
  prNumber,
  headSha,
  treeSha,
}) {
  const artifactName = `quality-proof-${treeSha}`;
  const candidates = [...artifacts]
    .filter((artifact) => artifact.name === artifactName && !artifact.expired)
    .sort((left, right) => right.id - left.id);

  for (const artifact of candidates) {
    const runId = artifact.workflow_run?.id;
    if (!Number.isSafeInteger(runId)) {
      continue;
    }
    const qualityRun = loadRun(runId);
    if (
      isSuccessfulQualityRunForPr(qualityRun, {
        repository,
        prNumber,
        headSha,
      })
    ) {
      return runId;
    }
  }

  return undefined;
}

function requireSuccessfulQuality(repository, prNumber, headSha) {
  const pullRequest = ghApi(`repos/${repository}/pulls/${prNumber}`);
  if (!pullRequest.merge_commit_sha) {
    throw new Error(
      "GitHub has not produced a merge preview commit for the current PR. Merge aborted.",
    );
  }
  const mergeCommit = ghApi(
    `repos/${repository}/git/commits/${pullRequest.merge_commit_sha}`,
  );
  const treeSha = resolveCurrentMergeTree(pullRequest, mergeCommit, headSha);
  const artifactName = `quality-proof-${treeSha}`;
  const artifactResponse = ghApi(
    `repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`,
  );
  const qualityRunId = findSuccessfulQualityRunId({
    artifacts: artifactResponse.artifacts ?? [],
    loadRun: (runId) => ghApi(`repos/${repository}/actions/runs/${runId}`),
    repository,
    prNumber,
    headSha,
    treeSha,
  });

  if (qualityRunId === undefined) {
    throw new Error(
      `No successful Quality proof exists for the current prospective merge tree ${treeSha}. Merge aborted.`,
    );
  }

  console.log(
    `Verified Quality run ${qualityRunId} for prospective merge tree ${treeSha}.`,
  );
}

export function main() {
  const gitDir = run("git", ["rev-parse", "--git-dir"]);
  const proofPath = join(gitDir, "foodfolio", "review-proof.json");

  if (!existsSync(proofPath)) {
    throw new Error(
      `Review proof not found: ${proofPath}. A Reviewer must run npm run review:lgtm first.`,
    );
  }

  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  if (
    proof.version !== 1 ||
    proof.verdict !== "LGTM" ||
    !proof.pr ||
    !proof.reviewed_sha
  ) {
    throw new Error("Review proof is invalid or is not an LGTM proof.");
  }

  const localHead = run("git", ["rev-parse", "HEAD"]);
  const repository = readRepository();
  let pr = readPr();

  if (pr.state !== "OPEN" || pr.isDraft) {
    throw new Error(
      `PR #${pr.number} must be open and ready for review before merge.`,
    );
  }
  if (pr.number !== proof.pr) {
    throw new Error(
      `Review proof is for PR #${proof.pr}, but current branch belongs to PR #${pr.number}.`,
    );
  }
  if (
    localHead !== proof.reviewed_sha ||
    pr.headRefOid !== proof.reviewed_sha
  ) {
    throw new Error(
      `LGTM is stale. reviewed_sha=${proof.reviewed_sha}, local_head=${localHead}, pr_head=${pr.headRefOid}. Re-review the latest HEAD.`,
    );
  }

  console.log(`Final human check: PR #${pr.number}`);
  console.log(`LGTM reviewed_sha: ${proof.reviewed_sha}`);
  console.log("Waiting for PR checks...");
  run("gh", ["pr", "checks", String(pr.number), "--watch", "--fail-fast"], {
    inherit: true,
  });
  requireSuccessfulQuality(repository, pr.number, proof.reviewed_sha);

  pr = readPr();
  if (pr.headRefOid !== proof.reviewed_sha) {
    throw new Error(
      `PR HEAD changed after checks. reviewed_sha=${proof.reviewed_sha}, current_pr_head=${pr.headRefOid}. Merge aborted.`,
    );
  }

  console.log(
    "All final checks passed. Executing human-requested SHA-bound merge...",
  );
  run(
    "gh",
    [
      "pr",
      "merge",
      String(pr.number),
      "--merge",
      "--delete-branch",
      "--match-head-commit",
      proof.reviewed_sha,
    ],
    { inherit: true },
  );

  rmSync(proofPath, { force: true });
  console.log("Merge succeeded. Review proof removed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
