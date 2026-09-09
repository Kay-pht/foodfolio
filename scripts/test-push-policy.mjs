import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";

const hook = ".githooks/pre-push";
chmodSync(hook, 0o755);
const result = spawnSync("bash", [hook, "origin", "git@github.com:Kay-pht/foodfolio.git"], {
  input: "refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 2222222222222222222222222222222222222222\n",
  encoding: "utf8",
});

if (result.status === 0) {
  throw new Error("pre-push hook did not reject a direct main push.");
}
if (!`${result.stderr}${result.stdout}`.includes("direct pushes to main are prohibited")) {
  throw new Error(`pre-push hook failed for an unexpected reason: ${result.stderr || result.stdout}`);
}

const source = readFileSync(hook, "utf8");
if (!source.includes('"refs/heads/main"')) {
  throw new Error("pre-push hook no longer checks refs/heads/main.");
}

console.log("Direct main push policy hook test passed.");
