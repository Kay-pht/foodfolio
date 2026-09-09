import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(repositoryRoot, "scripts", "check-specs.mjs");
const schema = join(repositoryRoot, "specs", "schema.json");
const root = mkdtempSync(join(tmpdir(), "foodfolio-specs-negative-"));
const outside = `${root}-outside.txt`;

function yaml({
  condition = "A condition",
  extraRequirement = "",
  verification = "proof.txt",
  type = "feature",
  regressionRequired = false,
  regressionTests = "[]",
} = {}) {
  return `id: TEST-001\ntype: ${type}\nstatus: approved\nobjective: Test specification\nrequirements:\n  - id: R1\n    condition: ${condition}\n    expected: Expected result\n    verification:\n      - ${verification}\n${extraRequirement}edge_cases: []\nsecurity_invariants: []\ncompatibility: []\nnon_functional: []\nout_of_scope: []\nacceptance_criteria: []\nregression:\n  required: ${regressionRequired}\n  tests: ${regressionTests}\n`;
}

function run(source) {
  writeFileSync(join(root, "specs", "tasks", "TEST-001.yaml"), source);
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
  });
}

function expectFailure(source, pattern) {
  const result = run(source);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}

try {
  mkdirSync(join(root, "specs", "tasks"), { recursive: true });
  cpSync(schema, join(root, "specs", "schema.json"));
  writeFileSync(join(root, "proof.txt"), "proof\n");
  mkdirSync(join(root, "proof-dir"));
  writeFileSync(outside, "outside\n");

  expectFailure(
    yaml({ condition: '""' }),
    /schema \/requirements\/0\/condition/,
  );
  expectFailure(
    yaml({ extraRequirement: "    unknown_field: value\n" }),
    /schema \/requirements\/0: must NOT have additional properties/,
  );
  expectFailure(
    yaml({ verification: `../${basename(outside)}` }),
    /verification path escapes repository/,
  );
  expectFailure(
    yaml({ verification: "proof-dir" }),
    /verification path is not a file/,
  );
  expectFailure(
    yaml({
      type: "bug",
      regressionRequired: true,
      regressionTests: `\n    - ../${basename(outside)}`,
    }),
    /regression test path escapes repository/,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { force: true });
}

console.log("Specification negative guardrail assertions passed.");
