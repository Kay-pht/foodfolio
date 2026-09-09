import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const gitDir = run("git", ["rev-parse", "--git-dir"]);
const localHead = run("git", ["rev-parse", "HEAD"]);
const pr = JSON.parse(run("gh", ["pr", "view", "--json", "number,headRefOid,state,isDraft"]));

if (pr.state !== "OPEN") {
  throw new Error(`PR #${pr.number} is not open.`);
}
if (pr.isDraft) {
  throw new Error(`PR #${pr.number} is still draft. Complete verification before LGTM.`);
}
if (pr.headRefOid !== localHead) {
  throw new Error(`Local HEAD ${localHead} does not match PR HEAD ${pr.headRefOid}.`);
}

const proofPath = join(gitDir, "foodfolio", "review-proof.json");
mkdirSync(dirname(proofPath), { recursive: true });
writeFileSync(
  proofPath,
  `${JSON.stringify(
    {
      version: 1,
      verdict: "LGTM",
      pr: pr.number,
      reviewed_sha: pr.headRefOid,
      created_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

console.log(`LGTM proof written for PR #${pr.number} at ${pr.headRefOid}`);
console.log(`Proof: ${proofPath}`);
