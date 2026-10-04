import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { classifyDeploymentRange } from "../../scripts/classify-deployment-range.mjs";

const execFileAsync = promisify(execFile);
const verifierPath = fileURLToPath(
  new URL("../../scripts/verify-cloud-run-deployment.mjs", import.meta.url),
);
const serviceName = "foodfolio-dev-worker";
const revisionName = "foodfolio-dev-worker-00001-test";
const image =
  "asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app:test";
const imageDigest = `${image.split(":")[0]}@sha256:${"a".repeat(64)}`;

async function runVerifier({ billing = "true", mode = "json" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "foodfolio-cloud-run-cli-"));
  try {
    const ready = { conditions: [{ type: "Ready", status: "True" }] };
    const fixtures = {
      service: {
        metadata: { name: serviceName },
        spec: {
          template: {
            metadata: {
              annotations: { "run.googleapis.com/cpu-throttling": "true" },
            },
            spec: {
              containers: [
                { image, env: [{ name: "SECRET", value: "private-fixture" }] },
              ],
            },
          },
        },
        status: {
          ...ready,
          latestCreatedRevisionName: revisionName,
          latestReadyRevisionName: revisionName,
          traffic: [{ revisionName, percent: 100 }],
        },
      },
      revision: {
        metadata: {
          name: revisionName,
          annotations: { "run.googleapis.com/cpu-throttling": billing },
        },
        spec: { containers: [{ image: imageDigest }] },
        status: ready,
      },
    };
    await writeFile(join(directory, "fixtures.json"), JSON.stringify(fixtures));
    await writeFile(
      join(directory, "gcloud"),
      `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.CLI_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.CLI_MODE === "failure") {
  process.stderr.write("private-fixture");
  process.exit(1);
}
if (process.env.CLI_MODE === "invalid") {
  process.stdout.write("private-fixture");
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(process.env.CLI_FIXTURES, "utf8"));
process.stdout.write(JSON.stringify(process.argv[3] === "services" ? data.service : data.revision));
`,
      { mode: 0o755 },
    );
    let result;
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [verifierPath, serviceName],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            PROJECT_ID: "foodfolio-af28aa",
            REGION: "asia-southeast1",
            IMAGE: image,
            IMAGE_DIGEST: imageDigest,
            CLI_FIXTURES: join(directory, "fixtures.json"),
            CLI_CALLS: join(directory, "calls.jsonl"),
            CLI_MODE: mode,
          },
        },
      );
      result = { code: 0, stdout, stderr };
    } catch (error) {
      result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
    const calls = (await readFile(join(directory, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return { ...result, calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("ICR-2 deployed verification CLI", () => {
  it("exits successfully only after checking the service and actual serving revision", async () => {
    const result = await runVerifier();
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      serviceName,
      revisionName,
      billing: "request-based",
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("private-fixture");
    expect(result.calls).toEqual([
      [
        "run",
        "services",
        "describe",
        serviceName,
        "--project",
        "foodfolio-af28aa",
        "--region",
        "asia-southeast1",
        "--format=json",
      ],
      [
        "run",
        "revisions",
        "describe",
        revisionName,
        "--project",
        "foodfolio-af28aa",
        "--region",
        "asia-southeast1",
        "--format=json",
      ],
    ]);
  });

  it.each([
    [
      { billing: "false" },
      "Serving revision does not use request-based billing",
    ],
    [{ mode: "failure" }, "Cloud Run describe failed"],
    [{ mode: "invalid" }, "Cloud Run describe returned invalid JSON"],
  ])(
    "fails deployment without disclosing raw CLI output: %j",
    async (config, message) => {
      const result = await runVerifier(config);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(message);
      expect(result.stderr).not.toContain("private-fixture");
    },
  );
});

describe("ICR-3 deployed Git range classification", () => {
  it.each([
    [".github/workflows/deploy-dev.yml", true],
    ["scripts/verify-cloud-run-deployment.mjs", true],
    ["docs/infrastructure-cost-reduction.md", false],
  ])("classifies an isolated %s change as deploy=%s", async (path, deploy) => {
    const directory = await mkdtemp(join(tmpdir(), "foodfolio-deploy-range-"));
    const git = async (args) => execFileAsync("git", args, { cwd: directory });
    try {
      await git(["init", "--initial-branch=main"]);
      await git(["config", "user.name", "Foodfolio test"]);
      await git(["config", "user.email", "test@example.invalid"]);
      await writeFile(join(directory, "README.md"), "initial\n");
      await git(["add", "."]);
      await git(["commit", "-m", "initial"]);
      const { stdout: base } = await git(["rev-parse", "HEAD"]);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), "changed\n");
      await git(["add", "."]);
      await git(["commit", "-m", "change"]);
      const { stdout: head } = await git(["rev-parse", "HEAD"]);
      const result = await classifyDeploymentRange({
        deployedSha: base.trim(),
        targetSha: head.trim(),
        git: async (args) => {
          try {
            await git(args);
            return 0;
          } catch (error) {
            return error.code;
          }
        },
      });
      expect(result.deploy).toBe(deploy);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
