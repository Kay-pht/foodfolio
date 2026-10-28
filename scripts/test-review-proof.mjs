import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  requireChatLgtm,
  requireIndependentProof,
  transition,
  validateResult,
  validateLedger,
  validateSuccessfulCommands,
} from "./review-flow.mjs";

const source = readFileSync("scripts/pr-final-merge.mjs", "utf8");
for (const required of [
  "review-proof.json",
  "reviewed_sha",
  "--match-head-commit",
  "--watch",
  "--fail-fast",
  "rmSync(proofPath",
  "requireIndependentProof(proof, pr)",
]) {
  assert.ok(source.includes(required), `Missing merge guardrail: ${required}`);
}

const pr = { number: 42, headRefOid: "a".repeat(40) };
const successfulCommands = (sha) => [
  {
    command: "npm run verify",
    sha,
    exitCode: 0,
    evidence: "Local verification log",
  },
];
const context = {
  request: "Original user request reference",
  specs: ["specs/tasks/REVIEW-FLOW-HARNESS-001.yaml"],
  verification: "Required verification passed; local log and CI run references",
  successfulCommands: successfulCommands(pr.headRefOid),
};
const finding = (classification) => ({
  classification,
  evidence: "Approved requirement and affected code path",
  impact: "Specific behavior affected",
  reproduction: "Concrete steps or contract comparison",
});
const result = (sha, findings = []) => ({
  reviewedSha: sha,
  verdict: findings.some(
    (item) => item.classification !== "specification_change",
  )
    ? "AUTOMATION_BLOCKED"
    : "LGTM",
  findings,
});
const step = (ledger, command, options = {}) =>
  transition(ledger, command, {
    pr,
    session: "implementer",
    ...options,
  });
assert.throws(() => step(undefined, "start", { session: undefined }));
let ledger = step(undefined, "start");
assert.throws(() => step(ledger, "start"));
assert.throws(() => requireChatLgtm(undefined, pr, "implementer"));
assert.throws(() => requireIndependentProof({}, pr));
assert.throws(() =>
  step(ledger, "request", { reviewer: "implementer", context }),
);
assert.throws(() =>
  step(ledger, "request", { reviewer: "reviewer", context: {} }),
);
assert.throws(() =>
  step(ledger, "request", { session: "other", reviewer: "reviewer", context }),
);
ledger = step(ledger, "request", { reviewer: "reviewer", context });
assert.throws(() => step(ledger, "request", { reviewer: "other", context }));
assert.throws(() => step(ledger, "result", { result: result(pr.headRefOid) }));
assert.throws(() =>
  step(ledger, "result", {
    session: "reviewer",
    result: result("b".repeat(40)),
  }),
);
assert.throws(() =>
  validateResult(
    result(pr.headRefOid, [{ classification: "bug" }]),
    pr.headRefOid,
  ),
);
assert.throws(() =>
  validateResult(
    { ...result(pr.headRefOid, [finding("bug")]), verdict: "LGTM" },
    pr.headRefOid,
  ),
);
assert.throws(() =>
  validateResult(
    {
      ...result(pr.headRefOid, [finding("specification_change")]),
      verdict: "AUTOMATION_BLOCKED",
    },
    pr.headRefOid,
  ),
);
validateResult(result(pr.headRefOid, [finding("unclear")]), pr.headRefOid);
ledger = step(ledger, "result", {
  session: "reviewer",
  result: result(pr.headRefOid, [finding("specification_change")]),
});
assert.throws(() =>
  step(ledger, "result", {
    session: "reviewer",
    result: result(pr.headRefOid),
  }),
);
assert.throws(() => requireChatLgtm(ledger, pr, "reviewer"));
ledger = step(ledger, "delivered", {
  session: "reviewer",
  reference: "Return message in original chat",
});
requireChatLgtm(ledger, pr, "reviewer");
const legacy = JSON.parse(JSON.stringify(ledger));
delete legacy.reviews[0].context.successfulCommands;
validateLedger(legacy, pr);
assert.throws(
  () => requireChatLgtm(legacy, pr, "reviewer"),
  /successfulCommands/,
);

assert.throws(() => requireChatLgtm(ledger, pr, "implementer"));
assert.throws(() => requireChatLgtm(ledger, pr, ""));
assert.throws(() => requireChatLgtm(ledger, { ...pr, number: 43 }, "reviewer"));
assert.throws(() =>
  requireChatLgtm(ledger, { ...pr, headRefOid: "b".repeat(40) }, "reviewer"),
);
assert.throws(() => step(ledger, "request", { reviewer: "another", context }));
for (let cycle = 1; cycle <= 3; cycle++) {
  pr.headRefOid = String(cycle).repeat(40);
  context.successfulCommands = successfulCommands(pr.headRefOid);
  assert.throws(() =>
    step(ledger, "request", { reviewer: "reviewer", context }),
  );
  const reviewer = `reviewer-${cycle}`;
  ledger = step(ledger, "request", { reviewer, context });
  ledger = step(ledger, "result", {
    session: reviewer,
    result: result(pr.headRefOid, [finding("bug")]),
  });
  ledger = step(ledger, "delivered", {
    session: reviewer,
    reference: `Return ${cycle}`,
  });
  assert.throws(() => requireChatLgtm(ledger, pr, reviewer));
}
pr.headRefOid = "f".repeat(40);
assert.throws(
  () => step(ledger, "request", { reviewer: "reviewer-4", context }),
  /three re-reviews exhausted/,
);
assert.equal(ledger.reviews.length, 4);

// Successful implementation verification is consumed without repeating commands.
const verifiedSha = "e".repeat(40);
const verified = successfulCommands(verifiedSha);
validateSuccessfulCommands(verified, verifiedSha);
for (const invalid of [
  undefined,
  [],
  [{ ...verified[0], exitCode: 1 }],
  [{ ...verified[0], sha: "f".repeat(40) }],
  [{ ...verified[0], evidence: "" }],
  [verified[0], verified[0]],
]) {
  assert.throws(() => validateSuccessfulCommands(invalid, verifiedSha));
}
const extra = {
  command: "node local-specific-reproducer.mjs",
  reason: "A concrete uncovered boundary in the changed code",
  evidence: "Additional-check log",
  exitCode: 0,
};
validateResult(
  { ...result(verifiedSha), additionalChecks: [extra] },
  verifiedSha,
  verified,
);
assert.throws(
  () =>
    validateResult(
      {
        ...result(verifiedSha),
        additionalChecks: [{ ...extra, command: " npm   run verify " }],
      },
      verifiedSha,
      verified,
    ),
  /Do not rerun/,
);
assert.throws(() =>
  validateResult(
    { ...result(verifiedSha), additionalChecks: [{ ...extra, reason: "" }] },
    verifiedSha,
    verified,
  ),
);
assert.throws(
  () =>
    validateResult(
      { ...result(verifiedSha), additionalChecks: [{ ...extra, exitCode: 1 }] },
      verifiedSha,
      verified,
    ),
  /blocks LGTM/,
);
validateResult(
  {
    ...result(verifiedSha),
    verdict: "AUTOMATION_BLOCKED",
    additionalChecks: [{ ...extra, exitCode: 1 }],
  },
  verifiedSha,
  verified,
);
const previous = transition(undefined, "start", {
  pr: { number: 7, headRefOid: verifiedSha },
  session: "implementer",
});
assert.throws(
  () =>
    transition(previous, "request", {
      pr: { number: 7, headRefOid: verifiedSha },
      session: "implementer",
      reviewer: "new-reviewer",
      context: { ...context, successfulCommands: undefined },
    }),
  /successfulCommands/,
);

// Execute the real CLI and proof writer against a disposable Git repository.
const directory = mkdtempSync(join(tmpdir(), "foodfolio-review-flow-"));
try {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-q");
  writeFileSync(join(directory, "fixture"), "fixture");
  git("add", "fixture");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "fixture",
  );
  const sha = git("rev-parse", "HEAD");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}\nprocess.stdout.write(process.env.REVIEW_PR_FIXTURE);\n`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REVIEW_PR_FIXTURE: JSON.stringify({
      number: 42,
      headRefOid: sha,
      state: "OPEN",
      isDraft: false,
    }),
  };
  const cli = (session, script, ...args) =>
    execFileSync(process.execPath, [resolve(script), ...args], {
      cwd: directory,
      env: { ...env, CODEX_THREAD_ID: session },
      stdio: "pipe",
    });
  const flow = (session, ...args) =>
    cli(session, "scripts/review-flow.mjs", ...args);
  const proof = (session, ...args) =>
    cli(session, "scripts/review-proof.mjs", ...args);
  const contextPath = join(directory, "context.json");
  const resultPath = join(directory, "result.json");
  writeFileSync(
    contextPath,
    JSON.stringify({ ...context, successfulCommands: successfulCommands(sha) }),
  );
  writeFileSync(resultPath, JSON.stringify(result(sha)));
  assert.throws(() => proof("implementer"));
  flow("implementer", "start");
  assert.throws(() => flow("implementer", "start"));
  flow(
    "implementer",
    "request",
    "--reviewer",
    "reviewer",
    "--context",
    contextPath,
  );
  assert.throws(() => proof("reviewer"));
  assert.throws(() => flow("implementer", "result", "--file", resultPath));
  flow("reviewer", "result", "--file", resultPath);
  assert.throws(() => proof("reviewer"));
  flow(
    "reviewer",
    "delivered",
    "--reference",
    "Observed return message reference",
  );
  assert.throws(() => proof("implementer"));
  assert.throws(() => proof("reviewer", "--typo"));
  assert.throws(() => proof("implementer", "--attestation", resultPath));
  proof("reviewer");
  const proofPath = join(directory, ".git/foodfolio/review-proof.json");
  const saved = JSON.parse(readFileSync(proofPath, "utf8"));
  assert.equal(saved.reviewed_sha, sha);
  assert.equal(saved.chatReview.implementerChat, "implementer");
  requireIndependentProof(saved, { number: 42, headRefOid: sha });
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-qm",
    "updated",
  );
  const updated = git("rev-parse", "HEAD");
  env.REVIEW_PR_FIXTURE = JSON.stringify({
    number: 42,
    headRefOid: updated,
    state: "OPEN",
    isDraft: false,
  });
  assert.throws(() => proof("reviewer"));
  writeFileSync(
    contextPath,
    JSON.stringify({
      ...context,
      successfulCommands: successfulCommands(updated),
    }),
  );
  flow(
    "implementer",
    "request",
    "--reviewer",
    "reviewer-2",
    "--context",
    contextPath,
  );
  assert.throws(() => readFileSync(proofPath));
  mkdirSync(join(directory, ".git/foodfolio/review-flow.lock"));
  assert.throws(() => flow("implementer", "status"));
  rmSync(join(directory, ".git/foodfolio/review-flow.lock"), {
    recursive: true,
  });
  const final = JSON.parse(flow("implementer", "status").toString());
  assert.equal(final.reviews.length, 2);
  assert.equal(final.reviews[0].sha, sha);
  assert.equal(final.reviews[1].sha, updated);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  "Independent review flow, CLI, proof and merge guardrail tests passed.",
);
