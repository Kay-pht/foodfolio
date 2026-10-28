import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_RE_REVIEWS = 3;
const text = (value) => typeof value === "string" && value.trim().length > 0;
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizeCommand = (command) => command.trim().replace(/\s+/gu, " ");

export function validateSuccessfulCommands(commands, sha) {
  requireThat(
    Array.isArray(commands) && commands.length > 0,
    "A nonempty successfulCommands handoff is required.",
  );
  const seen = new Set();
  for (const entry of commands) {
    requireThat(
      text(entry?.command) &&
        entry.sha === sha &&
        entry.exitCode === 0 &&
        text(entry.evidence),
      "Successful commands require command, matching SHA, exitCode 0 and evidence.",
    );
    const command = normalizeCommand(entry.command);
    requireThat(!seen.has(command), "Duplicate successful command in handoff.");
    seen.add(command);
  }
}

export function validateResult(result, sha, successfulCommands = []) {
  requireThat(result?.reviewedSha === sha, "Review result SHA is stale.");
  requireThat(
    ["LGTM", "AUTOMATION_BLOCKED"].includes(result.verdict) &&
      Array.isArray(result.findings),
    "A verdict and classified findings are required.",
  );
  for (const finding of result.findings) {
    requireThat(
      ["bug", "specification_change", "unclear"].includes(
        finding?.classification,
      ) &&
        text(finding.evidence) &&
        text(finding.impact) &&
        text(finding.reproduction),
      "Every finding requires classification, evidence, impact and reproduction.",
    );
  }
  requireThat(
    result.additionalChecks === undefined ||
      Array.isArray(result.additionalChecks),
    "additionalChecks must be an array when supplied.",
  );
  const verified = new Set(
    successfulCommands.map((entry) => normalizeCommand(entry.command)),
  );
  for (const check of result.additionalChecks ?? []) {
    requireThat(
      text(check?.command) &&
        text(check.reason) &&
        text(check.evidence) &&
        Number.isSafeInteger(check.exitCode) &&
        check.exitCode >= 0,
      "Additional checks require command, concrete reason, evidence and exitCode.",
    );
    requireThat(
      !verified.has(normalizeCommand(check.command)),
      "Do not rerun a successful command handed off by the implementer.",
    );
    requireThat(
      check.exitCode === 0 || result.verdict === "AUTOMATION_BLOCKED",
      "A failed additional check blocks LGTM.",
    );
  }
  const blockers = result.findings.filter(
    (finding) => finding.classification !== "specification_change",
  );
  requireThat(
    result.verdict ===
      (blockers.length ||
      result.additionalChecks?.some((check) => check.exitCode !== 0)
        ? "AUTOMATION_BLOCKED"
        : "LGTM"),
    "Bugs and unclear behavior block LGTM; specification proposals alone do not.",
  );
}

export function validateLedger(ledger, pr) {
  requireThat(
    ledger?.version === 1 &&
      ledger.pr === pr.number &&
      text(ledger.implementerChat) &&
      Array.isArray(ledger.reviews) &&
      ledger.reviews.length <= MAX_RE_REVIEWS + 1,
    "Invalid PR-bound review ledger.",
  );
  const reviewerChat = ledger.reviews[0]?.reviewerChat;
  for (const review of ledger.reviews) {
    requireThat(
      text(review.reviewerChat) &&
        review.reviewerChat !== ledger.implementerChat &&
        review.reviewerChat === reviewerChat &&
        /^[a-f0-9]{40,64}$/.test(review.sha ?? "") &&
        text(review.context?.request) &&
        text(review.context?.verification) &&
        Array.isArray(review.context?.specs) &&
        review.context.specs.length > 0 &&
        review.context.specs.every(text),
      "Each review must reuse the same independent reviewer chat with SHA and handoff context.",
    );
    // Preserve historical reviews written before structured handoff was introduced.
    if (review.context.successfulCommands !== undefined) {
      validateSuccessfulCommands(review.context.successfulCommands, review.sha);
    }
    if (review.result) {
      validateResult(
        review.result,
        review.sha,
        review.context.successfulCommands,
      );
    }
    requireThat(
      !review.delivery || (review.result && text(review.delivery)),
      "A delivered review requires a result and return reference.",
    );
  }
}

export function requireChatLgtm(ledger, pr, session) {
  validateLedger(ledger, pr);
  const review = ledger.reviews.at(-1);
  requireThat(review?.sha === pr.headRefOid, "Latest review SHA is stale.");
  validateSuccessfulCommands(review.context.successfulCommands, review.sha);
  requireThat(
    review.result?.verdict === "LGTM" && text(review.delivery),
    "Independent LGTM result and return delivery record are required.",
  );
  if (session !== undefined) {
    requireThat(
      text(session) && session === review.reviewerChat,
      "Only the registered independent reviewer chat may record LGTM.",
    );
  }
  return review;
}

export function requireIndependentProof(proof, pr) {
  if (proof.automation) {
    const automation = proof.automation;
    requireThat(
      !proof.chatReview &&
        automation.version === 1 &&
        automation.reviewedSha === pr.headRefOid &&
        text(automation.reviewerSession) &&
        Array.isArray(automation.authorSessions) &&
        automation.authorSessions.length > 0 &&
        automation.authorSessions.every(
          (id) => text(id) && id !== automation.reviewerSession,
        ),
      "Invalid independent-session review attestation for current PR HEAD.",
    );
  } else {
    requireChatLgtm(proof.chatReview, pr);
  }
}

export function transition(
  ledger,
  command,
  { pr, session, reviewer, context, result, reference },
) {
  requireThat(
    text(session),
    "CODEX_THREAD_ID is required; do not invent an identity.",
  );
  if (command === "start") {
    requireThat(!ledger, "Review ledger already exists; preserve its history.");
    return { version: 1, pr: pr.number, implementerChat: session, reviews: [] };
  }
  validateLedger(ledger, pr);
  const next = JSON.parse(JSON.stringify(ledger));
  const latest = next.reviews.at(-1);
  if (command === "request") {
    requireThat(
      session === next.implementerChat,
      "Only the original implementer may request review.",
    );
    requireThat(
      next.reviews.length < MAX_RE_REVIEWS + 1,
      "AUTOMATION_BLOCKED: three re-reviews exhausted; ask the user.",
    );
    requireThat(
      !latest ||
        (latest.result && latest.delivery) ||
        latest.sha !== pr.headRefOid,
      "Wait for the active review and its return before requesting another.",
    );
    requireThat(
      !latest || latest.sha !== pr.headRefOid,
      "Re-review requires an updated HEAD; do not repeat the same review.",
    );
    validateSuccessfulCommands(context?.successfulCommands, pr.headRefOid);
    next.reviews.push({ reviewerChat: reviewer, sha: pr.headRefOid, context });
  } else {
    requireThat(
      latest?.reviewerChat === session,
      "Only the registered reviewer may submit or deliver the result.",
    );
    requireThat(
      latest.sha === pr.headRefOid,
      "Review HEAD changed; request re-review in the same reviewer chat.",
    );
    if (command === "result") {
      requireThat(!latest.result, "Review result is immutable.");
      validateResult(result, latest.sha, latest.context.successfulCommands);
      latest.result = result;
    } else if (command === "delivered") {
      requireThat(
        latest.result && !latest.delivery && text(reference),
        "Result and a new return-message reference are required.",
      );
      latest.delivery = reference;
    } else {
      throw new Error(`Unknown review flow command: ${command}`);
    }
  }
  validateLedger(next, pr);
  return next;
}

export function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

export function reviewPaths(pr) {
  const gitDir = run("git", ["rev-parse", "--git-dir"]);
  const directory = join(gitDir, "foodfolio");
  return {
    directory,
    ledgerPath: join(directory, `review-flow-${pr.number}.json`),
    proofPath: join(directory, "review-proof.json"),
    lockPath: join(directory, "review-flow.lock"),
  };
}

export function withReviewLock(paths, action) {
  mkdirSync(paths.directory, { recursive: true });
  mkdirSync(paths.lockPath); // Existing lock fails closed; never steal an active lock.
  try {
    return action();
  } finally {
    rmSync(paths.lockPath, { recursive: true });
  }
}

export function readLedger(paths) {
  return existsSync(paths.ledgerPath)
    ? JSON.parse(readFileSync(paths.ledgerPath, "utf8"))
    : undefined;
}

export function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function currentPr() {
  const pr = JSON.parse(
    run("gh", ["pr", "view", "--json", "number,headRefOid,state,isDraft,url"]),
  );
  requireThat(
    pr.state === "OPEN" && !pr.isDraft,
    "Review requires an open Ready PR after validation.",
  );
  requireThat(
    pr.headRefOid === run("git", ["rev-parse", "HEAD"]),
    "Local HEAD and PR HEAD differ.",
  );
  return pr;
}

export function main() {
  const [command, ...args] = process.argv.slice(2);
  const allowed = {
    start: [],
    status: [],
    request: ["--reviewer", "--context"],
    result: ["--file"],
    delivered: ["--reference"],
  };
  requireThat(
    Object.hasOwn(allowed, command),
    "Use start, request, result, delivered or status.",
  );
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    requireThat(
      allowed[command].includes(args[index]) &&
        text(args[index + 1]) &&
        !Object.hasOwn(options, args[index]),
      "Invalid or repeated review flow option.",
    );
    options[args[index]] = args[index + 1];
  }
  requireThat(
    allowed[command].every((key) => text(options[key])),
    "Missing review flow option.",
  );
  const pr = currentPr();
  const paths = reviewPaths(pr);
  withReviewLock(paths, () => {
    const ledger = readLedger(paths);
    if (command === "status") {
      validateLedger(ledger, pr);
      console.log(JSON.stringify(ledger, null, 2));
      return;
    }
    const next = transition(ledger, command, {
      pr,
      session: process.env.CODEX_THREAD_ID,
      reviewer: options["--reviewer"],
      context: options["--context"]
        ? JSON.parse(readFileSync(options["--context"], "utf8"))
        : undefined,
      result: options["--file"]
        ? JSON.parse(readFileSync(options["--file"], "utf8"))
        : undefined,
      reference: options["--reference"],
    });
    const refreshed = currentPr();
    requireThat(
      refreshed.number === pr.number && refreshed.headRefOid === pr.headRefOid,
      "PR changed during ledger update.",
    );
    // Invalidate before updating so a partially failed request never leaves usable proof.
    if (command === "request") rmSync(paths.proofPath, { force: true });
    saveJson(paths.ledgerPath, next);
    console.log(
      JSON.stringify({ ledger: resolve(paths.ledgerPath), ...next }, null, 2),
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
