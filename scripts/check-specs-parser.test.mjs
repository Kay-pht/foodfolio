import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["scripts/check-specs.mjs"], { stdio: "inherit" });
