import { execFileSync } from "node:child_process";

const before = process.env.MAIN_PUSH_BEFORE_SHA;
const after = process.env.MAIN_PUSH_AFTER_SHA;

if (!before || !after) {
  throw new Error("MAIN_PUSH_BEFORE_SHA and MAIN_PUSH_AFTER_SHA are required.");
}
if (/^0+$/.test(after)) {
  process.exit(0);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

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
}

console.log(`Main push policy passed for ${commits.length} first-parent commit(s).`);
