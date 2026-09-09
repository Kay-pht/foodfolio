import { execFileSync } from "node:child_process";

const checks = [
  [process.execPath, ["scripts/check-specs.mjs"]],
  [process.execPath, ["scripts/test-push-policy.mjs"]],
  [process.execPath, ["scripts/check-main-push-policy.test.mjs"]],
  [process.execPath, ["scripts/test-review-proof.mjs"]],
  [process.execPath, ["scripts/check-specs-negative.test.mjs"]],
];

for (const [command, args] of checks) {
  execFileSync(command, args, { stdio: "inherit" });
}

console.log("Autonomous P0 verification passed.");
