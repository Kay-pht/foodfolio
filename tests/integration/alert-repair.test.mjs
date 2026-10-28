import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  symlink,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  changedPaths,
  command,
  requireReviewedController,
  processQueue,
  snapshot,
} from "../../scripts/alert-repair/runner.mjs";
import { readState } from "../../scripts/alert-repair/core.mjs";
import {
  externalValidation,
  withLock,
} from "../../scripts/alert-repair/cli.mjs";
import { harness } from "../helpers/alert-repair-fixture.mjs";
import { prepareHandoff, runAgent } from "../../scripts/alert-repair/agent.mjs";

describe("alert repair integration", () => {
  it("does not leave temporary authentication when handoff preparation fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "foodfolio-handoff-failure-"),
    );
    try {
      const stage = join(directory, "stage");
      const authDirectory = join(directory, "saved-auth");
      await mkdir(stage);
      await mkdir(authDirectory);
      await writeFile(
        join(authDirectory, "auth.json"),
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { access_token: "fixture-not-a-real-token" },
        }),
      );
      vi.stubEnv("CODEX_HOME", authDirectory);
      expect(() =>
        runAgent({
          role: "review",
          incident: {},
          directory,
          stageDirectory: stage,
          context: { red: { report: join(directory, "missing-red.json") } },
          codexPath: join(directory, "must-not-start"),
        }),
      ).toThrow();
      await expect(
        readFile(join(stage, ".codex/auth.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("copies only selected verification evidence into the next isolated stage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-handoff-"));
    try {
      const previous = join(directory, "previous");
      const next = join(directory, "next");
      await mkdir(previous);
      await mkdir(next);
      await writeFile(join(previous, "red.json"), '{"assertion":"failed"}');
      await writeFile(
        join(previous, "verification.json"),
        '{"unit":"passed","integration":"passed","e2e":"passed"}',
      );
      await writeFile(
        join(previous, "conversation.json"),
        "must not be copied",
      );
      const input = {
        red: { report: join(previous, "red.json") },
        verification: { evidence: join(previous, "verification.json") },
      };
      const output = prepareHandoff(input, next);
      expect(output.red.report).toBe(join(next, "handoff/red.json"));
      expect(input.red.report).toBe(join(previous, "red.json"));
      expect(
        JSON.parse(await readFile(output.verification.evidence, "utf8")).e2e,
      ).toBe("passed");
      const { readdir } = await import("node:fs/promises");
      expect((await readdir(join(next, "handoff"))).sort()).toEqual([
        "red.json",
        "verification.json",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("refuses an unmerged or locally modified controller before starting incident work", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "foodfolio-controller-approval-"),
    );
    const git = (...args) =>
      execFileSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    try {
      git("init", "-q", "-b", "main");
      await mkdir(join(directory, "specs/tasks"), { recursive: true });
      await writeFile(
        join(directory, "specs/tasks/ALERT-REPAIR-001.yaml"),
        "status: approved\n",
      );
      git("add", ".");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "main",
      );
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("switch", "-qc", "codex/new-controller");
      await mkdir(join(directory, "scripts/alert-repair"), { recursive: true });
      await writeFile(
        join(directory, "scripts/alert-repair/core.mjs"),
        "// committed controller\n",
      );
      git("add", ".");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "feature",
      );
      expect(() => requireReviewedController(directory)).toThrow();
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      expect(() => requireReviewedController(directory)).not.toThrow();
      await writeFile(
        join(directory, "scripts/alert-repair/core.mjs"),
        "// locally altered\n",
      );
      expect(() => requireReviewedController(directory)).toThrow(
        /local changes/,
      );
      git("restore", "scripts/alert-repair/core.mjs");
      await writeFile(
        join(directory, "scripts/review-flow.mjs"),
        "// unreviewed proof dependency\n",
      );
      expect(() => requireReviewedController(directory)).toThrow(
        /local changes/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("writes real SHA-bound LGTM proof only with distinct author and reviewer identities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-review-proof-"));
    try {
      execFileSync("git", ["init", "-q", directory]);
      await writeFile(join(directory, "fixture.txt"), "fixture");
      execFileSync("git", ["-C", directory, "add", "fixture.txt"]);
      execFileSync("git", [
        "-C",
        directory,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "fixture",
      ]);
      const head = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const bin = join(directory, "bin");
      await mkdir(bin);
      await writeFile(
        join(bin, "gh"),
        `#!${process.execPath}\nprocess.stdout.write(process.env.PR_FIXTURE);\n`,
        { mode: 0o700 },
      );
      const attestation = join(directory, "attestation.json");
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PR_FIXTURE: JSON.stringify({
          state: "OPEN",
          isDraft: false,
          number: 42,
          headRefOid: head,
        }),
      };
      const run = () =>
        execFileSync(
          process.execPath,
          [resolve("scripts/review-proof.mjs"), "--attestation", attestation],
          { cwd: directory, env, stdio: "pipe" },
        );
      const proof = {
        version: 1,
        reviewedSha: head,
        reviewerSession: "reviewer-session",
        authorSessions: ["reviewer-session"],
      };
      await writeFile(attestation, JSON.stringify(proof));
      expect(run).toThrow();
      proof.authorSessions = ["implementer-session", "fixer-session"];
      await writeFile(attestation, JSON.stringify(proof));
      expect(run).not.toThrow();
      const saved = JSON.parse(
        await readFile(
          join(directory, ".git/foodfolio/review-proof.json"),
          "utf8",
        ),
      );
      expect(saved.reviewed_sha).toBe(head);
      expect(saved.automation.reviewerSession).toBe("reviewer-session");
      proof.reviewedSha = "f".repeat(40);
      await writeFile(attestation, JSON.stringify(proof));
      expect(run).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps third-party command output in private evidence instead of notifications", async () => {
    const fixture = await harness();
    try {
      let failure;
      const path = join(fixture.directory, "failure.json");
      try {
        command(
          process.execPath,
          ["-e", "console.error('fixture-private-response');process.exit(1)"],
          { failureLog: path },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure.message).not.toContain("fixture-private-response");
      expect(await readFile(path, "utf8")).toContain(
        "fixture-private-response",
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
  it("runs real failing and passing assertions and an independent review/fix/review cycle", async () => {
    const fixture = await harness({
      reviewDecisions: ["review_changes", "review_pass"],
    });
    try {
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("LGTM");
      expect(fixture.calls.indexOf("verify:red")).toBeLessThan(
        fixture.calls.indexOf("implement"),
      );
      expect(
        fixture.calls.filter((call) => call === "verify:green"),
      ).toHaveLength(2);
      expect(fixture.calls.filter((call) => call === "review")).toHaveLength(2);
      const saved = await readState(fixture.directory);
      const identities = saved.cases[0].sessions.map((session) => session.id);
      expect(new Set(identities).size).toBe(identities.length);
      expect(saved.cases[0].attestation.reviewedSha).toBe(saved.cases[0].head);
      expect(saved.cases[0].attestation.authorSessions).not.toContain(
        saved.cases[0].attestation.reviewerSession,
      );
      expect(saved.outbox.map((entry) => entry.status)).toEqual([
        "PR_CREATED",
        "LGTM",
      ]);
      expect(
        await readFile(join(fixture.workspace, "docs/contract.md"), "utf8"),
      ).toBe("The value must be one.");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("keeps specification proposals separate and Draft without granting new product approval", async () => {
    const fixture = await harness({ kind: "spec_change" });
    try {
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("SPEC_APPROVAL_REQUIRED");
      expect(fixture.calls).toContain("publish");
      expect(fixture.calls).not.toContain("quality");
      expect(fixture.calls).not.toContain("review");
      expect(fixture.calls).not.toContain("proof");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("does not implement expected failures or start the second queued incident", async () => {
    const fixture = await harness({ kind: "no_bug" });
    try {
      fixture.state.cases.push({
        ...fixture.incident,
        id: "second",
        sessions: [],
        budget: [],
      });
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("NO_BUG");
      expect(fixture.calls).toEqual(["triage"]);
      expect(fixture.state.cases[1].status).toBe("queued");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("blocks an interrupted case without repeating its external writes", async () => {
    const fixture = await harness();
    try {
      fixture.incident.status = "running";
      await processQueue(fixture);
      expect(fixture.incident.status).toBe("AUTOMATION_BLOCKED");
      expect(fixture.calls).toEqual([]);
      expect(fixture.state.outbox[0].text).toContain("中断");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("uses real Git paths and refuses symlinks out of the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-alert-git-"));
    try {
      execFileSync("git", ["init", "-q", directory]);
      await writeFile(join(directory, "original.txt"), "original");
      execFileSync("git", ["-C", directory, "add", "original.txt"]);
      execFileSync("git", [
        "-C",
        directory,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "fixture",
      ]);
      await writeFile(join(directory, "original.txt"), "changed");
      await writeFile(join(directory, "new.txt"), "new");
      expect(changedPaths(directory).sort()).toEqual([
        "new.txt",
        "original.txt",
      ]);
      await symlink("/etc/hosts", join(directory, "escape.txt"));
      expect(() => snapshot(directory, ["escape.txt"])).toThrow(/ordinary/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("locks overlapping invocations and releases the lock on failure", async () => {
    const fixture = await harness();
    try {
      await expect(
        withLock(fixture.directory, async () => {
          await expect(
            withLock(fixture.directory, async () => {}),
          ).rejects.toThrow(/active/);
          throw new Error("fixture interruption");
        }),
      ).rejects.toThrow(/interruption/);
      expect(await withLock(fixture.directory, async () => "unlocked")).toBe(
        "unlocked",
      );
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("persists budget before a real adapter executes and refuses a duplicate charged request", async () => {
    const fixture = await harness();
    try {
      const output = join(fixture.directory, "adapter-observed.json");
      const adapter = {
        command: process.execPath,
        args: [
          "-e",
          `const fs=require('node:fs');const s=JSON.parse(fs.readFileSync(${JSON.stringify(join(fixture.directory, "state.json"))},'utf8'));fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(s.cases[0].budget));console.log('safe fixture evidence')`,
        ],
        maximumMilliYen: 30000,
        pricingEvidence: "https://example.test/pricing",
        validUntil: "2099-01-01T00:00:00Z",
        environmentKeys: [],
      };
      await writeFile(
        join(fixture.directory, "external-adapters.json"),
        JSON.stringify({ fixture: adapter }),
      );
      // The incident directory is normally created before the first agent.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(fixture.directory, fixture.incident.id));
      await externalValidation(
        fixture.directory,
        fixture.state,
        fixture.incident.id,
        "fixture",
        "first",
      );
      expect(JSON.parse(await readFile(output, "utf8"))[0].executed).toBe(true);
      await expect(
        externalValidation(
          fixture.directory,
          fixture.state,
          fixture.incident.id,
          "fixture",
          "first",
        ),
      ).rejects.toThrow(/already attempted/);
      await expect(
        externalValidation(
          fixture.directory,
          fixture.state,
          fixture.incident.id,
          "fixture",
          "second",
        ),
      ).rejects.toThrow(/30 yen/);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
