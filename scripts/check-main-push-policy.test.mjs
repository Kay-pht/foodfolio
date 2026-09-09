import { readFileSync } from "node:fs";

const source = readFileSync("scripts/check-main-push-policy.mjs", "utf8");
for (const required of [
  "MAIN_PUSH_BEFORE_SHA",
  "MAIN_PUSH_AFTER_SHA",
  "--first-parent",
  "parents.length < 2",
  "AUTOMATION VIOLATION",
]) {
  if (!source.includes(required))
    throw new Error(`check-main-push-policy.mjs is missing: ${required}`);
}
console.log("Main push policy checker test passed.");
