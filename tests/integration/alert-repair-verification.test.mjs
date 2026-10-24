import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assertRedReport } from "../../scripts/alert-repair/core.mjs";
import * as runner from "../../scripts/alert-repair/runner.mjs";

const root = process.cwd();
const git = (directory, ...args) =>
  execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
function repository() {
  const directory = mkdtempSync(
    join(tmpdir(), "foodfolio-verification-regression-"),
  );
  git(directory, "init", "-q");
  writeFileSync(join(directory, "base.txt"), "base");
  git(directory, "add", ".");
  git(
    directory,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "base",
  );
  return directory;
}

describe("alert repair reviewed verification regressions", () => {
  it("reads correct hook configuration without writing sandbox-protected Git metadata", () => {
    const directory = repository();
    try {
      const script = join(directory, "install-git-hooks.mjs");
      cpSync(join(root, "scripts/install-git-hooks.mjs"), script);
      git(directory, "config", "core.hooksPath", ".githooks");
      const ordinaryRun = () =>
        spawnSync(process.execPath, [script], {
          cwd: directory,
          encoding: "utf8",
        });
      const configuredInode = statSync(join(directory, ".git/config")).ino;
      expect(ordinaryRun().status).toBe(0);
      expect(statSync(join(directory, ".git/config")).ino).toBe(
        configuredInode,
      );
      git(directory, "config", "core.hooksPath", "wrong");
      expect(
        spawnSync(process.execPath, [script], { cwd: directory }).status,
      ).toBe(0);
      expect(git(directory, "config", "--get", "core.hooksPath")).toBe(
        ".githooks",
      );
      git(directory, "config", "--unset", "core.hooksPath");
      expect(ordinaryRun().status).toBe(0);
      expect(git(directory, "config", "--get", "core.hooksPath")).toBe(
        ".githooks",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("includes untracked iOS additions and committed incident changes when selecting local verification", () => {
    const directory = repository();
    try {
      const base = git(directory, "rev-parse", "HEAD");
      mkdirSync(join(directory, "ios"));
      writeFileSync(join(directory, "ios/NewScreen.swift"), "import SwiftUI\n");
      expect(runner.requiresIosVerification).toBeTypeOf("function");
      expect(runner.requiresIosVerification(directory, base)).toBe(true);
      git(directory, "add", "ios");
      git(
        directory,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "ios",
      );
      expect(runner.requiresIosVerification(directory, base)).toBe(true);
      expect(
        runner.requiresIosVerification(
          directory,
          git(directory, "rev-parse", "HEAD"),
        ),
      ).toBe(false);
      mkdirSync(join(directory, "src"));
      writeFileSync(join(directory, "src/worker.ts"), "// backend only\n");
      expect(
        runner.requiresIosVerification(
          directory,
          git(directory, "rev-parse", "HEAD"),
        ),
      ).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects real Vitest hook/runtime failures and accepts only body assertion failures", () => {
    const directory = mkdtempSync(join(tmpdir(), "foodfolio-red-provenance-"));
    try {
      symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
      const cases = [
        [
          "beforeEach",
          "beforeEach(() => { throw new Error('ECONNREFUSED setup'); }); it('test', () => expect(1).toBe(1));",
          false,
        ],
        [
          "hook-assertion",
          "beforeEach(() => expect(1).toBe(2)); it('test', () => expect(1).toBe(1));",
          false,
        ],
        [
          "afterEach",
          "afterEach(() => { throw new Error('teardown failed'); }); it('test', () => expect(1).toBe(2));",
          false,
        ],
        [
          "beforeAll",
          "beforeAll(() => { throw new Error('setup failed'); }); it('test', () => expect(1).toBe(1));",
          false,
        ],
        [
          "runtime",
          "it('test', () => { throw new Error('connection failed'); });",
          false,
        ],
        [
          "import",
          "import './missing-module.mjs'; it('test', () => expect(1).toBe(2));",
          false,
        ],
        [
          "assertion",
          "beforeEach(() => {}); afterEach(() => {}); it('test', () => expect(1).toBe(2));",
          true,
        ],
      ];
      for (const [name, source, accepted] of cases) {
        const test = join(directory, `${name}.test.mjs`);
        writeFileSync(
          test,
          `import { beforeEach, afterEach, beforeAll, it, expect } from 'vitest';\n${source}\n`,
        );
        const report = join(directory, `${name}.json`);
        const reporter = join(root, "scripts/alert-repair/red-reporter.mjs");
        const run = spawnSync(
          process.execPath,
          [
            join(root, "node_modules/vitest/vitest.mjs"),
            "run",
            test,
            "--root",
            directory,
            "--maxWorkers=1",
            "--minWorkers=1",
            `--reporter=${reporter}`,
            `--outputFile=${report}`,
          ],
          { cwd: directory, encoding: "utf8", timeout: 30000 },
        );
        expect(run.status, run.stderr).toBe(1);
        const result = JSON.parse(readFileSync(report, "utf8"));
        rmSync(test);
        if (accepted) expect(() => assertRedReport(result), name).not.toThrow();
        else
          expect(() => assertRedReport(result), name).toThrow(/assertion|RED/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60000);
});
