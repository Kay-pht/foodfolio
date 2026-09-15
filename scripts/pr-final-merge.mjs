import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
  })?.trim();
}

function readPr() {
  return JSON.parse(
    run("gh", ["pr", "view", "--json", "number,headRefOid,state,isDraft"]),
  );
}

function readChecks(prNumber) {
  return JSON.parse(
    run("gh", [
      "pr",
      "checks",
      String(prNumber),
      "--json",
      "name,workflow,bucket",
    ]),
  );
}

function requireSuccessfulQuality(prNumber) {
  const checks = readChecks(prNumber);
  const quality = checks.find(
    (check) =>
      check.workflow === "Quality" &&
      check.name === "checks" &&
      check.bucket === "pass",
  );

  if (!quality) {
    throw new Error(
      "Required Quality / checks has not completed successfully for the current PR head. Merge aborted.",
    );
  }
}

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
if (localHead !== proof.reviewed_sha || pr.headRefOid !== proof.reviewed_sha) {
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
requireSuccessfulQuality(pr.number);

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
