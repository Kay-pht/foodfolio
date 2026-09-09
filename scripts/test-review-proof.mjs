import { readFileSync } from "node:fs";

const source = readFileSync("scripts/pr-final-merge.mjs", "utf8");
for (const required of [
  "review-proof.json",
  "reviewed_sha",
  "--match-head-commit",
  "--watch",
  "--fail-fast",
  "rmSync(proofPath",
]) {
  if (!source.includes(required)) {
    throw new Error(
      `pr-final-merge.mjs is missing required guardrail: ${required}`,
    );
  }
}

const reviewerSource = readFileSync("scripts/review-proof.mjs", "utf8");
if (
  !reviewerSource.includes('join(gitDir, "foodfolio", "review-proof.json")')
) {
  throw new Error(
    "Review proof must be stored under the Git directory, outside the tracked worktree.",
  );
}

console.log("Review proof and final merge guardrail tests passed.");
