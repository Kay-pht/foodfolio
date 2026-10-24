import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digest, initialState } from "../../scripts/alert-repair/core.mjs";
import { assertFrozen, snapshot } from "../../scripts/alert-repair/runner.mjs";

export function result(decision, extra = {}) {
  return {
    decision,
    summary: "Confirmed deterministic fixture",
    expectedBehavior: "The value is one.",
    rootCauseKey: "fixture-confirmed-cause",
    reviewedSha: "",
    needsExternalValidation: false,
    regressionTests: ["tests/unit/value.test.mjs"],
    evidence: [{ path: "docs/contract.md", reason: "The value must be one." }],
    findings: [],
    ...extra,
  };
}

export async function harness({
  reviewDecisions = ["review_pass"],
  kind = "bug",
  mutateReview = false,
  mutateContract = false,
  qualityFails = false,
  external = false,
  reuseSession = false,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "foodfolio-alert-test-"));
  const workspace = join(directory, "repo");
  for (const path of ["src", "docs", "tests/unit", "specs/tasks"])
    await mkdir(join(workspace, path), { recursive: true });
  await writeFile(join(workspace, "src/value.txt"), "0");
  await writeFile(
    join(workspace, "docs/contract.md"),
    "The value must be one.",
  );
  const state = initialState();
  const incident = {
    id: "fixture-incident",
    thread: "1792584000.123456",
    channel: "C0C4D12AD3J",
    alert: "Fixture monitoring alert",
    status: "queued",
    sessions: [],
    fixes: 0,
    budget: [],
    pr: null,
  };
  state.cases.push(incident);
  const calls = [];
  let serial = 0;
  let reviews = 0;
  let published = false;
  let generated = [];
  let head = "a".repeat(40);
  const adapters = {
    async createWorkspace(entry) {
      entry.workspace = workspace;
      entry.base = head;
      entry.repository = "example/repo";
      entry.branch = "codex/fixture";
    },
    async logs() {
      return [];
    },
    async agent({ role, incident: entry }) {
      calls.push(role);
      let output;
      if (role === "triage")
        output = result(kind, { needsExternalValidation: external });
      else if (role === "prepare") {
        generated = ["specs/tasks/FIXTURE.yaml", "tests/unit/value.test.mjs"];
        await writeFile(
          join(workspace, generated[0]),
          "fixture approved expectation",
        );
        await writeFile(
          join(workspace, generated[1]),
          "frozen direct regression expectation",
        );
        output = result("implemented");
      } else if (role === "implement" || role === "fix") {
        await writeFile(join(workspace, "src/value.txt"), "1");
        generated = [...new Set([...generated, "src/value.txt"])];
        published = false;
        if (mutateContract)
          await writeFile(
            join(workspace, "tests/unit/value.test.mjs"),
            "weakened expectation",
          );
        output = result("implemented");
      } else {
        output = result(
          reviewDecisions[Math.min(reviews++, reviewDecisions.length - 1)],
          { reviewedSha: entry.head },
        );
        if (output.decision === "review_changes")
          output.findings = [
            {
              id: "F1",
              path: "src/value.txt",
              requirement: "Original value contract",
              problem: "Concrete fixture failure",
              reproduction: "Run the direct value regression",
            },
          ];
        if (mutateReview)
          await writeFile(join(workspace, "src/value.txt"), "2");
      }
      return {
        id: reuseSession ? "session-reused" : `session-${++serial}`,
        result: output,
      };
    },
    paths() {
      return published ? [] : [...generated];
    },
    tracked() {
      return [];
    },
    format() {},
    snapshot,
    assertFrozen,
    expectations() {
      return snapshot(workspace, ["docs/contract.md"]);
    },
    verify(repo, entry, stage, mode) {
      calls.push(`verify:${mode}`);
      if (mode === "spec") return { specification: true };
      let failed = false;
      try {
        execFileSync(
          process.execPath,
          [
            "-e",
            "require('node:assert/strict').equal(require('node:fs').readFileSync('src/value.txt','utf8'),'1')",
          ],
          { cwd: repo, stdio: "pipe" },
        );
      } catch {
        failed = true;
      }
      if (mode === "red") {
        if (!failed) throw new Error("Fixture failed to reproduce");
        return { red: true };
      }
      if (failed) throw new Error("Fixture regression still fails");
      return { green: true };
    },
    publish(entry) {
      calls.push("publish");
      head = digest(`${head}:${serial}`).slice(0, 40);
      entry.head = head;
      entry.pr = { number: 1, url: "https://github.com/example/repo/pull/1" };
      published = true;
    },
    readyAndQuality(entry) {
      calls.push("quality");
      if (qualityFails) throw new Error("Quality failed");
      return { head: entry.head, quality: "fixture" };
    },
    head() {
      return head;
    },
    diff() {
      return "fixture diff";
    },
    async unchanged() {
      if ((await readFile(join(workspace, "src/value.txt"), "utf8")) !== "1")
        throw new Error("Reviewer changed source files");
    },
    draft() {
      calls.push("draft");
    },
    proof(entry, attestation) {
      calls.push("proof");
      entry.attestation = attestation;
    },
  };
  return { directory, state, incident, calls, adapters, workspace };
}
