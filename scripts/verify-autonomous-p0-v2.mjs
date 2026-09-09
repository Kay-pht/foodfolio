import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { stdio: "inherit" });

for (const script of [
  "scripts/validate-p0-files.mjs",
  "scripts/check-specs.mjs",
  "scripts/test-push-policy.mjs",
  "scripts/check-main-push-policy.test.mjs",
  "scripts/test-review-proof.mjs",
  "scripts/check-specs-negative.test.mjs",
]) {
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}

console.log("Autonomous P0 verification passed.");
