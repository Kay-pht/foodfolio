import assert from "node:assert/strict";

import {
  assertMainPushPolicy,
  hasExactPullRequestMergeRelationship,
} from "./check-main-push-policy.mjs";

const commit = "a".repeat(40);
const parentOne = "b".repeat(40);
const parentTwo = "c".repeat(40);

function mergeGit(args) {
  if (args[0] === "rev-list" && args[1] === "--first-parent") return commit;
  if (args[0] === "rev-list" && args[1] === "--parents") {
    return `${commit} ${parentOne} ${parentTwo}`;
  }
  throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
}

const exactPullRequest = {
  merged_at: "2026-09-09T00:00:00Z",
  base: { ref: "main" },
  merge_commit_sha: commit,
};

assert.equal(
  hasExactPullRequestMergeRelationship(commit, [exactPullRequest]),
  true,
);
assert.equal(
  hasExactPullRequestMergeRelationship(commit, [
    { ...exactPullRequest, merge_commit_sha: "d".repeat(40) },
  ]),
  false,
);

await assert.doesNotReject(() =>
  assertMainPushPolicy({
    before: parentOne,
    after: commit,
    repository: "Kay-pht/foodfolio",
    token: "token",
    git: mergeGit,
    api: async () => [exactPullRequest],
  }),
);

await assert.rejects(
  () =>
    assertMainPushPolicy({
      before: parentOne,
      after: commit,
      repository: "Kay-pht/foodfolio",
      token: "token",
      git: mergeGit,
      api: async () => [],
    }),
  /without an exact merged pull request relationship to main/,
);

await assert.rejects(
  () =>
    assertMainPushPolicy({
      before: parentOne,
      after: commit,
      repository: "Kay-pht/foodfolio",
      token: "token",
      git: mergeGit,
      api: async () => [
        { ...exactPullRequest, merge_commit_sha: "d".repeat(40) },
      ],
    }),
  /without an exact merged pull request relationship to main/,
);

console.log("Main push policy checker test passed.");
