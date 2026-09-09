import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API_VERSION = "2022-11-28";
const TARGET_BRANCH = "main";

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

async function defaultApi(path, { repository, token }) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "foodfolio-main-push-policy",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}) for ${path}: ${body}`,
    );
  }

  return response.json();
}

export function hasExactPullRequestMergeRelationship(commit, pullRequests) {
  return pullRequests.some(
    (pullRequest) =>
      pullRequest?.merged_at &&
      pullRequest?.base?.ref === TARGET_BRANCH &&
      pullRequest?.merge_commit_sha === commit,
  );
}

export async function assertMainPushPolicy({
  before,
  after,
  repository,
  token,
  git = defaultGit,
  api = defaultApi,
}) {
  if (!before || !after) {
    throw new Error(
      "MAIN_PUSH_BEFORE_SHA and MAIN_PUSH_AFTER_SHA are required.",
    );
  }
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required.");
  }
  if (/^0+$/.test(after)) return 0;

  const range = /^0+$/.test(before) ? after : `${before}..${after}`;
  const commits = git(["rev-list", "--first-parent", range])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const commit of commits) {
    const parentLine = git(["rev-list", "--parents", "-n", "1", commit]);
    const parents = parentLine.split(/\s+/).slice(1);
    if (parents.length < 2) {
      throw new Error(
        `AUTOMATION VIOLATION: main received non-merge commit ${commit}. Direct pushes to main are prohibited; merge through a pull request.`,
      );
    }

    const pullRequests = await api(`/commits/${commit}/pulls`, {
      repository,
      token,
    });
    if (
      !Array.isArray(pullRequests) ||
      !hasExactPullRequestMergeRelationship(commit, pullRequests)
    ) {
      throw new Error(
        `AUTOMATION VIOLATION: main received merge commit ${commit} without an exact merged pull request relationship to main. Local merge commits pushed directly to main are prohibited.`,
      );
    }
  }

  return commits.length;
}

async function main() {
  const count = await assertMainPushPolicy({
    before: process.env.MAIN_PUSH_BEFORE_SHA,
    after: process.env.MAIN_PUSH_AFTER_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  });
  console.log(`Main push policy passed for ${count} first-parent commit(s).`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main();
}
