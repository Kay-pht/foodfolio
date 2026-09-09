import { execFileSync } from "node:child_process";

for (const script of [
  "scripts/check-specs.mjs",
  "scripts/test-push-policy.mjs",
  "scripts/check-main-push-policy.test.mjs",
  "scripts/test-review-proof.mjs",
]) {
  console.log(`Running ${script}`);
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}
