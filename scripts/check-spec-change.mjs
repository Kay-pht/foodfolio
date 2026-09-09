import { execFileSync } from "node:child_process";

const baseSha = process.env.SPEC_BASE_SHA;
const headSha = process.env.SPEC_HEAD_SHA;
const shaPattern = /^[0-9a-f]{40,64}$/;

if (!baseSha || !headSha || !shaPattern.test(baseSha) || !shaPattern.test(headSha)) {
  throw new Error("SPEC_BASE_SHA and SPEC_HEAD_SHA must be Git object IDs.");
}

const output = execFileSync(
  "git",
  [
    "diff",
    "--name-only",
    "--diff-filter=ACMRT",
    baseSha,
    headSha,
    "--",
    "specs/tasks",
  ],
  { encoding: "utf8" },
);

const changedSpecs = output
  .split("\n")
  .map((value) => value.trim())
  .filter((value) => value.endsWith(".yaml") || value.endsWith(".yml"));

if (changedSpecs.length === 0) {
  throw new Error(
    "Behavior-affecting changes require an approved Specification as Code file in specs/tasks/*.yaml in the PR diff.",
  );
}

console.log(`Specification change gate passed: ${changedSpecs.join(", ")}`);
