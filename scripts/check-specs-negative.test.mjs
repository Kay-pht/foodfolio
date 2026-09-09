import { readFileSync } from "node:fs";

const source = readFileSync("scripts/check-specs.mjs", "utf8");
for (const required of [
  "bug specifications must set regression.required: true",
  "bug specifications must list at least one regression test",
  "duplicate requirement id",
  "verification path does not exist",
  "status must be 'approved'",
]) {
  if (!source.includes(required))
    throw new Error(`Specification checker is missing guardrail: ${required}`);
}
console.log("Specification negative guardrail assertions passed.");
