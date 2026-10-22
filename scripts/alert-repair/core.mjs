import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const POLICY = Object.freeze({
  channel: "C0C4D12AD3J",
  hoursJst: [5, 17],
  maxFixes: 3,
  budgetMilliYen: 30_000,
  overlapSeconds: 300,
  scanSeconds: 12 * 60 * 60,
});

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function initialState() {
  return { version: 1, cursor: null, cases: [], outbox: [], seen: {} };
}

export async function readState(directory) {
  try {
    const state = JSON.parse(
      await readFile(join(directory, "state.json"), "utf8"),
    );
    if (
      state.version !== 1 ||
      !Array.isArray(state.cases) ||
      !Array.isArray(state.outbox)
    ) {
      throw new Error(
        "Unsupported or damaged alert-repair state; refusing to reset it.",
      );
    }
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return initialState();
  }
}

export async function saveState(directory, state) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `state-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, join(directory, "state.json"));
}

export function scanWindow(state, now = Date.now()) {
  const latest = Math.floor(now / 1000);
  return {
    channel: POLICY.channel,
    oldest: String(
      state.cursor === null
        ? latest - POLICY.scanSeconds
        : Math.max(0, Number(state.cursor) - POLICY.overlapSeconds),
    ),
    latest: String(latest),
  };
}

export function beginScan(state, now = Date.now()) {
  state.scan = { ...scanWindow(state, now), id: randomUUID() };
  return state.scan;
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{10,12}(?:\.\d{1,6})?$/.test(value);
}

export function ingest(state, packet, now = Date.now()) {
  const expected = state.scan;
  if (
    !expected ||
    packet.scanId !== expected.id ||
    packet.oldest !== expected.oldest ||
    packet.latest !== expected.latest
  ) {
    throw new Error(
      "Scan identity and interval must match the saved scan request.",
    );
  }
  if (
    packet.channel !== POLICY.channel ||
    packet.complete !== true ||
    !Array.isArray(packet.messages) ||
    packet.nextCursor ||
    !validTimestamp(packet.oldest) ||
    !validTimestamp(packet.latest) ||
    Number(packet.latest) <= Number(packet.oldest) ||
    Number(packet.latest) > now / 1000 ||
    Number(packet.latest) < Number(state.cursor ?? 0)
  ) {
    throw new Error(
      "A complete, bounded Slack scan from the durable cursor is required.",
    );
  }
  // Validate the whole page set before changing anything, including the cursor.
  for (const message of packet.messages) {
    if (
      !validTimestamp(message.ts) ||
      typeof message.text !== "string" ||
      message.text.length > 50_000 ||
      Number(message.ts) < Number(packet.oldest) ||
      Number(message.ts) > Number(packet.latest)
    ) {
      throw new Error(
        "Invalid Slack message or message outside the scan interval.",
      );
    }
  }
  let queued = 0;
  for (const message of [...packet.messages].sort(
    (a, b) => Number(a.ts) - Number(b.ts),
  )) {
    const key = `${packet.channel}:${message.ts}`;
    if (Object.hasOwn(state.seen, key)) continue;
    state.seen[key] = true;
    // The Slack connector may render author metadata instead of exposing raw
    // bot_id/app_id. Never discard a parent alert solely because IDs are absent;
    // the read-only investigator must establish whether it is a runtime defect.
    if (
      (message.thread_ts && message.thread_ts !== message.ts) ||
      message.text.includes("[foodfolio-auto:")
    )
      continue;
    const id = digest(key).slice(0, 20);
    state.cases.push({
      id,
      channel: packet.channel,
      thread: message.ts,
      alert: message.text,
      status: "queued",
      fixes: 0,
      budget: [],
      sessions: [],
      pr: null,
      workspace: null,
      createdAt: new Date(now).toISOString(),
    });
    queued += 1;
  }
  state.cursor = packet.latest;
  delete state.scan;
  return queued;
}

export function notify(state, incident, status, reason = "") {
  const key = digest(
    `${incident.id}:${status}:${incident.head ?? ""}:${incident.fixes}`,
  ).slice(0, 24);
  if (state.outbox.some((entry) => entry.id === key)) return;
  state.outbox.push({
    id: key,
    caseId: incident.id,
    channel: incident.channel,
    thread: incident.thread,
    marker: `[foodfolio-auto:${key}]`,
    status,
    text: `[foodfolio-auto:${key}] ${status}\n${incident.pr?.url ?? ""}\n${reason.replace(/@/g, "＠").slice(0, 800)}`.trim(),
    delivered: null,
  });
}

export function acknowledge(state, id, timestamp) {
  if (!validTimestamp(timestamp))
    throw new Error("Slack's returned message timestamp is required.");
  const entry = state.outbox.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("Unknown notification.");
  if (entry.delivered && entry.delivered !== timestamp)
    throw new Error(
      "Notification already acknowledged with a different message.",
    );
  entry.delivered = timestamp;
}

export function reserveBudget(incident, { id, maximumMilliYen, purpose }) {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
    !Number.isSafeInteger(maximumMilliYen) ||
    maximumMilliYen <= 0 ||
    typeof purpose !== "string" ||
    !purpose.trim()
  )
    throw new Error("Known positive maximum cost and request ID are required.");
  const existing = incident.budget.find((entry) => entry.id === id);
  if (existing) {
    if (
      existing.maximumMilliYen !== maximumMilliYen ||
      existing.purpose !== purpose
    )
      throw new Error(
        "A reservation ID cannot be reused with different inputs.",
      );
    return existing;
  }
  const spent = incident.budget.reduce(
    (sum, entry) => sum + entry.maximumMilliYen,
    0,
  );
  if (spent + maximumMilliYen > POLICY.budgetMilliYen)
    throw new Error("Per-incident 30 yen cumulative budget exceeded.");
  const entry = { id, maximumMilliYen, purpose, executed: false };
  incident.budget.push(entry);
  return entry;
}

export function recordSession(state, incident, role, id, result) {
  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(id) ||
    state.cases.some((candidate) =>
      candidate.sessions.some((session) => session.id === id),
    )
  ) {
    throw new Error(
      "Missing or reused Codex session ID; independent sessions are mandatory.",
    );
  }
  const session = { id, role, result };
  incident.sessions.push(session);
  return session;
}

export function nextFix(incident) {
  if (incident.fixes >= POLICY.maxFixes)
    throw new Error("Maximum three review-fix attempts reached.");
  incident.fixes += 1;
}

export function validateEvidence(result) {
  if (
    !result.expectedBehavior?.trim() ||
    !Array.isArray(result.evidence) ||
    !result.evidence.length ||
    result.evidence.some((entry) => !entry.path || !entry.reason?.trim())
  ) {
    throw new Error(
      "Expected behavior and concrete original-contract evidence are required.",
    );
  }
}

export function safeTestPath(path) {
  if (
    typeof path !== "string" ||
    !/^tests\/(unit|integration|e2e)\/[a-zA-Z0-9_./-]+\.test\.(ts|mjs)$/.test(
      path,
    ) ||
    path.split("/").some((part) => !part || part === ".." || part === ".")
  ) {
    throw new Error(
      "Automatic regression proof requires an in-repository Vitest test path.",
    );
  }
  return path;
}

export function assertChanges(paths, phase, kind = "bug") {
  if (!paths.length) throw new Error("No reviewable changes were produced.");
  for (const path of paths) {
    if (
      path.split("/").includes("..") ||
      path.startsWith("/") ||
      /^(AGENTS\.md|\.github\/|\.githooks\/|scripts\/|package(?:-lock)?\.json$|eslint|tsconfig|tests\/helpers\/|docs\/agent\/)/.test(
        path,
      )
    ) {
      throw new Error(
        `Control-plane or unsupported file change requires human handling: ${path}`,
      );
    }
    if (
      phase === "prepare" &&
      !/^(tests\/(unit|integration|e2e)\/|specs\/tasks\/)/.test(path)
    ) {
      throw new Error(`Preparation must not change runtime behavior: ${path}`);
    }
    if (
      kind === "bug" &&
      /^(docs\/|specs\/)/.test(path) &&
      !path.startsWith("specs/tasks/")
    ) {
      throw new Error(
        `Existing product specification cannot be changed by a bug fix: ${path}`,
      );
    }
    if (
      !/^(src\/|tests\/|specs\/tasks\/|ios\/|prisma\/|docs\/|tasks\/unreleased\.md$)/.test(
        path,
      )
    ) {
      throw new Error(`Unsupported autonomous change: ${path}`);
    }
  }
}

export function assertRedReport(report) {
  const failedAssertions = (report.testResults ?? [])
    .flatMap((suite) => suite.assertionResults ?? [])
    .filter((test) => test.status === "failed");
  if (!failedAssertions.length || (report.numRuntimeErrorTestSuites ?? 0) > 0) {
    throw new Error(
      "RED must be a failing test assertion, not a setup, import or infrastructure failure.",
    );
  }
}

export function proofAttestation(incident, reviewerId) {
  const reviewer = incident.sessions.find(
    (session) => session.id === reviewerId && session.role === "review",
  );
  const authors = incident.sessions
    .filter((session) => ["prepare", "implement", "fix"].includes(session.role))
    .map((session) => session.id);
  if (
    !reviewer ||
    reviewer.result.decision !== "review_pass" ||
    reviewer.result.reviewedSha !== incident.head ||
    !authors.length ||
    authors.includes(reviewerId)
  ) {
    throw new Error(
      "An independent successful review for this exact HEAD is required.",
    );
  }
  return {
    version: 1,
    caseId: incident.id,
    reviewerSession: reviewerId,
    authorSessions: authors,
    reviewedSha: incident.head,
  };
}
