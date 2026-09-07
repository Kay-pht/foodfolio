const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const PR_NUMBER_PATTERN = /^[1-9][0-9]*$/;

export function validateQualityDispatch({
  baseSha,
  eventSha,
  headRef,
  headSha,
  prNumber,
  pullRequest,
  repository,
}) {
  if (!GIT_SHA_PATTERN.test(baseSha) || !GIT_SHA_PATTERN.test(headSha)) {
    throw new Error("base_sha and head_sha must be Git object IDs");
  }
  if (!PR_NUMBER_PATTERN.test(prNumber)) {
    throw new Error("pr_number must be a positive integer");
  }
  if (eventSha !== headSha) {
    throw new Error(
      `Dispatched ref resolved to ${eventSha}, expected formatted head ${headSha}`,
    );
  }
  if (pullRequest.number !== Number(prNumber) || pullRequest.state !== "open") {
    throw new Error(`Pull request ${prNumber} is not open`);
  }
  if (
    pullRequest.head?.repo?.full_name !== repository ||
    pullRequest.base?.repo?.full_name !== repository
  ) {
    throw new Error(`Pull request ${prNumber} is not fully repository-owned`);
  }
  if (pullRequest.head.ref !== headRef || pullRequest.head.sha !== headSha) {
    throw new Error(`Pull request ${prNumber} no longer points to ${headSha}`);
  }
  if (pullRequest.base.sha !== baseSha) {
    throw new Error(
      `Pull request ${prNumber} base no longer matches ${baseSha}`,
    );
  }
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

async function main() {
  const baseSha = process.env.QUALITY_BASE_SHA;
  const eventSha = process.env.QUALITY_EVENT_SHA;
  const headRef = process.env.QUALITY_HEAD_REF;
  const headSha = process.env.QUALITY_HEAD_SHA;
  const prNumber = process.env.QUALITY_PR_NUMBER;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;

  if (
    !baseSha ||
    !eventSha ||
    !headRef ||
    !headSha ||
    !prNumber ||
    !repository ||
    !token
  ) {
    throw new Error("Quality dispatch context is incomplete");
  }

  const pullRequest = await githubApi(
    `/repos/${repository}/pulls/${prNumber}`,
    token,
  );
  validateQualityDispatch({
    baseSha,
    eventSha,
    headRef,
    headSha,
    prNumber,
    pullRequest,
    repository,
  });
  console.log(`Validated Quality dispatch for PR #${prNumber} at ${headSha}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
