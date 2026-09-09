import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});
console.log("Configured git hooks: core.hooksPath=.githooks");
