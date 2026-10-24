import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  POLICY,
  acknowledge,
  assertChanges,
  assertRedReport,
  beginScan,
  ingest,
  initialState,
  nextFix,
  notify,
  recordSession,
  reserveBudget,
  safeTestPath,
  scanWindow,
} from "../../scripts/alert-repair/core.mjs";
import {
  agentArgs,
  agentEnvironment,
  isolationProfile,
} from "../../scripts/alert-repair/agent.mjs";
import {
  processQueue,
  isControllerQualityEvidence,
  verificationEnvironment,
} from "../../scripts/alert-repair/runner.mjs";
import { harness } from "../helpers/alert-repair-fixture.mjs";

const now = Date.UTC(2026, 9, 22, 8);
function packet(state, messages = []) {
  const { id, ...window } = beginScan(state, now);
  return { ...window, scanId: id, complete: true, messages };
}

describe("alert repair contract", () => {
  it("binds dispatch CI with an empty PR list to the current head and prospective tree", () => {
    const run = {
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      name: "Quality",
      path: ".github/workflows/quality.yml",
      head_sha: "a".repeat(40),
      repository: { full_name: "example/repo" },
      head_repository: { full_name: "example/repo" },
      pull_requests: [],
    };
    const context = {
      repository: "example/repo",
      prNumber: 1,
      headSha: run.head_sha,
      treeSha: "b".repeat(40),
      artifacts: [{ name: `quality-proof-${"b".repeat(40)}`, expired: false }],
    };
    expect(isControllerQualityEvidence(run, context)).toBe(true);
    expect(
      isControllerQualityEvidence(run, { ...context, artifacts: [] }),
    ).toBe(false);
    expect(
      isControllerQualityEvidence(run, { ...context, headSha: "c".repeat(40) }),
    ).toBe(false);
    expect(
      isControllerQualityEvidence(
        { ...run, path: ".github/workflows/unrelated.yml" },
        context,
      ),
    ).toBe(false);
  });
  it("uses the agreed schedule and per-incident limits", async () => {
    expect(POLICY.channel).toBe("C0C4D12AD3J");
    expect(POLICY.hoursJst).toEqual([5, 17]);
    expect(POLICY.maxFixes).toBe(3);
    expect(POLICY.budgetMilliYen).toBe(30000);
  });

  it("starts at 12 hours and uses a persisted overlap after a complete scan", () => {
    const state = initialState();
    expect(Number(scanWindow(state, now).oldest)).toBe(now / 1000 - 43200);
    const scan = packet(state);
    ingest(state, scan, now);
    expect(scanWindow(state, now + 43200_000).oldest).toBe(
      String(now / 1000 - 300),
    );
  });

  it("never advances the cursor for partial, mismatched, future or invalid pages", () => {
    for (const change of [
      { complete: false },
      { nextCursor: "more" },
      { channel: "wrong" },
      { scanId: "wrong" },
      { latest: String(now / 1000 + 1) },
      { messages: [{ ts: "oops", text: "bad" }] },
    ]) {
      const state = initialState();
      expect(() =>
        ingest(state, { ...packet(state), ...change }, now),
      ).toThrow();
      expect(state.cursor).toBeNull();
      expect(state.cases).toEqual([]);
    }
  });

  it("deduplicates overlaps, accepts rendered alerts without bot IDs, and excludes replies and its own markers", () => {
    const state = initialState();
    const ts = String(now / 1000 - 10);
    const messages = [
      { ts, text: "Monitoring alert", bot_id: "monitor" },
      {
        ts: String(Number(ts) + 1),
        text: "reply",
        bot_id: "monitor",
        thread_ts: ts,
      },
      {
        ts: String(Number(ts) + 2),
        text: "Monitoring rendered alert without author IDs",
      },
      {
        ts: String(Number(ts) + 3),
        text: "[foodfolio-auto:marker]",
        bot_id: "monitor",
      },
    ];
    expect(ingest(state, packet(state, messages), now)).toBe(2);
    expect(ingest(state, packet(state, messages), now)).toBe(0);
    expect(state.cases).toHaveLength(2);
  });

  it("reserves at most 30 yen cumulatively and rejects unknown or recycled prices", () => {
    const incident = { budget: [], fixes: 0 };
    reserveBudget(incident, {
      id: "first",
      maximumMilliYen: 10000,
      purpose: "provider-test",
    });
    nextFix(incident);
    reserveBudget(incident, {
      id: "second",
      maximumMilliYen: 20000,
      purpose: "provider-test",
    });
    expect(() =>
      reserveBudget(incident, {
        id: "third",
        maximumMilliYen: 1,
        purpose: "provider-test",
      }),
    ).toThrow(/30 yen/);
    expect(() =>
      reserveBudget(incident, {
        id: "first",
        maximumMilliYen: 9000,
        purpose: "provider-test",
      }),
    ).toThrow(/different inputs/);
    expect(() =>
      reserveBudget(incident, {
        id: "nan",
        maximumMilliYen: NaN,
        purpose: "provider-test",
      }),
    ).toThrow();
    expect(() =>
      reserveBudget(incident, { id: "unknown", purpose: "provider-test" }),
    ).toThrow();
  });

  it("reconciles stable notification markers after an ambiguous send", () => {
    const state = initialState();
    const incident = {
      id: "one",
      channel: POLICY.channel,
      thread: "1792584000.000001",
      fixes: 0,
    };
    notify(state, incident, "LGTM", "No raw logs");
    notify(state, incident, "LGTM", "Repeated delivery attempt");
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0].channel).toBe(POLICY.channel);
    acknowledge(state, state.outbox[0].id, "1792584001.000001");
    acknowledge(state, state.outbox[0].id, "1792584001.000001");
    expect(() =>
      acknowledge(state, state.outbox[0].id, "1792584002.000001"),
    ).toThrow(/different/);
  });

  it("rejects reused sessions even across different incidents", () => {
    const state = initialState();
    const a = { sessions: [] },
      b = { sessions: [] };
    state.cases.push(a, b);
    recordSession(state, a, "implement", "session-12345", {});
    expect(() =>
      recordSession(state, b, "review", "session-12345", {}),
    ).toThrow(/reused/);
  });

  it("accepts assertion RED but rejects environment and import failures", () => {
    expect(() =>
      assertRedReport({
        testResults: [{ assertionResults: [{ status: "failed" }] }],
        redEvidence: {
          version: 1,
          unhandledErrors: 0,
          tasks: [
            {
              type: "test",
              state: "fail",
              hooks: {},
              errorNames: ["AssertionError"],
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertRedReport({ numRuntimeErrorTestSuites: 1, testResults: [] }),
    ).toThrow(/assertion/);
    expect(() => assertRedReport({ numFailedTests: 1 })).toThrow(/assertion/);
    expect(() =>
      assertRedReport({
        testResults: [{ assertionResults: [{ status: "failed" }] }],
      }),
    ).toThrow(/assertion/);
  });

  it("prevents runtime edits before specs, control-plane edits and path escapes", () => {
    for (const path of [
      "src/api/routes.ts",
      "scripts/alert-repair/core.mjs",
      "AGENTS.md",
      "../escape",
      ".github/workflows/quality.yml",
    ]) {
      expect(() => assertChanges([path], "prepare")).toThrow();
    }
    expect(() =>
      assertChanges(["docs/requirements-specification.md"], "fix", "bug"),
    ).toThrow(/specification/);
    expect(() => safeTestPath("tests/unit/../../escape.test.ts")).toThrow();
    expect(() => safeTestPath("--reporter=custom")).toThrow();
  });

  it("does not inherit API credentials or MCP settings and disables network tools", () => {
    const env = agentEnvironment("/isolated", "/node/bin");
    expect(Object.keys(env)).not.toContain("OPENAI_API_KEY");
    expect(Object.keys(verificationEnvironment("/isolated"))).not.toContain(
      "DATABASE_URL",
    );
    const args = agentArgs("review", "/repo", "/out", "/schema");
    expect(args).toContain("danger-full-access");
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("resume");
    expect(args).toContain("sandbox_workspace_write.network_access=false");
    const readonly = isolationProfile({
      userHome: "/secret",
      directory: "/repo",
      stageDirectory: "/stage",
      runtime: "/node",
    });
    expect(readonly).toContain('(deny file-read* (subpath "/secret"))');
    expect(readonly).toContain("(deny file-write*)");
    expect(readonly).not.toContain('(allow file-write* (subpath "/repo"))');
  });

  it("starts no agents when the queue is empty", async () => {
    const fixture = await harness();
    try {
      fixture.state.cases = [];
      expect(await processQueue(fixture)).toBeNull();
      expect(fixture.calls).toEqual([]);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a review bound to an older HEAD", async () => {
    const fixture = await harness();
    const originalAgent = fixture.adapters.agent;
    fixture.adapters.agent = async (request) => {
      const response = await originalAgent(request);
      if (request.role === "review")
        response.result.reviewedSha = "b".repeat(40);
      return response;
    };
    try {
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("AUTOMATION_BLOCKED");
      expect(fixture.incident.reason).toContain("current HEAD");
      expect(fixture.calls).not.toContain("proof");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("reuses a confirmed existing cause without creating another implementation or PR", async () => {
    const fixture = await harness();
    fixture.state.cases.unshift({
      id: "previous",
      status: "LGTM",
      rootCause: "fixture-confirmed-cause",
      sessions: [],
      pr: { number: 12, url: "https://github.com/example/repo/pull/12" },
    });
    try {
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("RELATED");
      expect(fixture.incident.pr.number).toBe(12);
      expect(fixture.calls).toEqual(["triage"]);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  for (const [name, options, requiredReason] of [
    ["a reviewer modifies code", { mutateReview: true }, "Reviewer changed"],
    [
      "implementation weakens the frozen regression",
      { mutateContract: true },
      "Frozen contract",
    ],
    ["session identities repeat", { reuseSession: true }, "reused"],
    ["CI fails", { qualityFails: true }, "Quality failed"],
    [
      "unpriced external validation is requested",
      { external: true },
      "外部API検証",
    ],
  ]) {
    it(`blocks when ${name}`, async () => {
      const fixture = await harness(options);
      try {
        await processQueue(fixture);
        expect(fixture.incident.status).toBe("AUTOMATION_BLOCKED");
        expect(fixture.incident.reason).toContain(requiredReason);
        expect(fixture.calls).not.toContain("proof");
        expect(fixture.state.outbox.at(-1).thread).toBe(
          fixture.incident.thread,
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }

  it("stops at exactly three fix attempts and never merges", async () => {
    const fixture = await harness({ reviewDecisions: ["review_changes"] });
    try {
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("AUTOMATION_BLOCKED");
      expect(fixture.incident.fixes).toBe(3);
      expect(fixture.calls.filter((call) => call === "fix")).toHaveLength(3);
      expect(fixture.calls.filter((call) => call === "review")).toHaveLength(4);
      expect(fixture.calls).not.toContain("proof");
      expect(fixture.calls).not.toContain("merge");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
