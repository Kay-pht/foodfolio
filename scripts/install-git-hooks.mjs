import { execFileSync, spawnSync } from "node:child_process";

const existing = spawnSync(
  "git",
  ["config", "--local", "--get", "core.hooksPath"],
  {
    encoding: "utf8",
  },
);
// The controller installs hooks before isolated verification. Avoid rewriting
// Git metadata when it is already correct; other values still require setup.
if (existing.status !== 0 || existing.stdout.trim() !== ".githooks") {
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
    stdio: "inherit",
  });
}
console.log("Configured git hooks: core.hooksPath=.githooks");
