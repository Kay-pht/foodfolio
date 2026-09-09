import { existsSync } from "node:fs";

const required = [
  ".githooks/pre-push",
  "specs/schema.json",
  "specs/tasks/AUTONOMOUS-P0-001.yaml",
  "docs/agent/review.md",
  "docs/agent/autonomous-p0.md",
  "scripts/check-specs.mjs",
  "scripts/review-proof.mjs",
  "scripts/pr-final-merge.mjs",
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing required P0 file: ${file}`);
}
console.log("Required autonomous P0 files are present.");
