import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  findReusableQualityRunId,
  isReusableQualityRun,
} from "../../scripts/find-reusable-quality-proof.mjs";
import { classifyDeploymentRange } from "../../scripts/classify-deployment-range.mjs";
import { classifyQualityPaths } from "../../scripts/classify-quality-changes.mjs";
import { validateQualityDispatch } from "../../scripts/validate-quality-dispatch.mjs";

const repository = "Kay-pht/foodfolio";
const validRun = {
  conclusion: "success",
  event: "pull_request",
  name: "Quality",
  path: ".github/workflows/quality.yml",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const validDispatch = {
  baseSha,
  eventSha: headSha,
  headRef: "codex/ci-auto-format",
  headSha,
  prNumber: "69",
  repository,
  pullRequest: {
    number: 69,
    state: "open",
    head: {
      ref: "codex/ci-auto-format",
      sha: headSha,
      repo: { full_name: repository },
    },
    base: { sha: baseSha, repo: { full_name: repository } },
  },
};

describe("PR Quality proof", () => {
  it("accepts a dispatch only for the current repository-owned PR head", () => {
    expect(() => validateQualityDispatch(validDispatch)).not.toThrow();
  });

  it("rejects a dispatch whose ref advanced past the formatted head", () => {
    expect(() =>
      validateQualityDispatch({
        ...validDispatch,
        eventSha: "c".repeat(40),
      }),
    ).toThrow(/expected formatted head/);
  });

  it("rejects stale, closed, and fork dispatch contexts", () => {
    expect(() =>
      validateQualityDispatch({
        ...validDispatch,
        pullRequest: {
          ...validDispatch.pullRequest,
          head: { ...validDispatch.pullRequest.head, sha: "c".repeat(40) },
        },
      }),
    ).toThrow(/no longer points/);
    expect(() =>
      validateQualityDispatch({
        ...validDispatch,
        pullRequest: { ...validDispatch.pullRequest, state: "closed" },
      }),
    ).toThrow(/not open/);
    expect(() =>
      validateQualityDispatch({
        ...validDispatch,
        pullRequest: {
          ...validDispatch.pullRequest,
          head: {
            ...validDispatch.pullRequest.head,
            repo: { full_name: "fork/foodfolio" },
          },
        },
      }),
    ).toThrow(/not fully repository-owned/);
  });

  it("accepts successful same-repository PR and dispatched Quality runs", () => {
    expect(isReusableQualityRun(validRun, repository)).toBe(true);
    expect(
      isReusableQualityRun(
        { ...validRun, event: "workflow_dispatch" },
        repository,
      ),
    ).toBe(true);
    expect(
      isReusableQualityRun({ ...validRun, conclusion: "failure" }, repository),
    ).toBe(false);
    expect(
      isReusableQualityRun({ ...validRun, event: "push" }, repository),
    ).toBe(false);
    expect(
      isReusableQualityRun(
        { ...validRun, head_repository: { full_name: "fork/foodfolio" } },
        repository,
      ),
    ).toBe(false);
  });

  it("returns a run only when the exact tree artifact has a trusted run", async () => {
    const treeSha = "a".repeat(40);
    const api = vi.fn(async (path) => {
      if (path.includes("/actions/artifacts?")) {
        return {
          artifacts: [
            {
              id: 2,
              name: `quality-proof-${treeSha}`,
              expired: false,
              workflow_run: { id: 102 },
            },
            {
              id: 1,
              name: `quality-proof-${treeSha}`,
              expired: false,
              workflow_run: { id: 101 },
            },
          ],
        };
      }
      if (path.endsWith("/102")) {
        return { ...validRun, conclusion: "failure" };
      }
      return validRun;
    });

    await expect(
      findReusableQualityRunId({
        repository,
        token: "token",
        treeSha,
        api,
      }),
    ).resolves.toBe(101);
  });

  it("fails closed when no unexpired exact-tree artifact is available", async () => {
    const treeSha = "b".repeat(40);
    const api = vi.fn(async () => ({
      artifacts: [
        {
          id: 1,
          name: `quality-proof-${treeSha}`,
          expired: true,
          workflow_run: { id: 101 },
        },
      ],
    }));

    await expect(
      findReusableQualityRunId({
        repository,
        token: "token",
        treeSha,
        api,
      }),
    ).resolves.toBeUndefined();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("keeps deploy gated by Quality and verifies manual deploys", async () => {
    const qualityWorkflow = await readFile(
      new URL("../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );
    const autoFormatWorkflow = await readFile(
      new URL("../../.github/workflows/auto-format.yml", import.meta.url),
      "utf8",
    );
    const documentationWorkflow = await readFile(
      new URL("../../.github/workflows/documentation.yml", import.meta.url),
      "utf8",
    );
    const deployWorkflow = await readFile(
      new URL("../../.github/workflows/deploy-dev.yml", import.meta.url),
      "utf8",
    );

    expect(qualityWorkflow).toContain("quality-proof-${{");
    expect(qualityWorkflow).toContain("Check task consistency");
    expect(qualityWorkflow).toContain("Check backend formatting");
    expect(qualityWorkflow).toContain("Run backend lint");
    expect(qualityWorkflow).toContain("Run architecture guardrails");
    expect(qualityWorkflow).toContain("Run documentation guardrails");
    expect(qualityWorkflow).toContain("Run iOS lint and format check");
    expect(qualityWorkflow).toContain("Generate Prisma client");
    expect(qualityWorkflow).toContain("Validate Prisma schema");
    expect(qualityWorkflow).toContain("Build backend");
    expect(qualityWorkflow).toContain("Run unit tests");
    expect(qualityWorkflow).toContain("Run integration tests");
    expect(qualityWorkflow).toContain("Run E2E tests");
    expect(qualityWorkflow).not.toMatch(/^\s*run:\s+npm run verify\s*$/m);
    expect(qualityWorkflow).toContain("swift:6.3@sha256:");
    expect(qualityWorkflow).not.toContain("runs-on: macos-");
    expect(qualityWorkflow).toContain(
      "types: [opened, synchronize, reopened, ready_for_review]",
    );
    expect(qualityWorkflow).toContain(
      "github.event.pull_request.draft == false",
    );
    expect(qualityWorkflow).toContain("workflow_dispatch:");
    expect(qualityWorkflow).toContain("Validate dispatched PR context");
    expect(qualityWorkflow).toContain("validate-quality-dispatch.mjs");
    expect(qualityWorkflow).toContain("stale-dispatch-{0}");
    expect(qualityWorkflow).toContain("pull-requests: read");
    expect(qualityWorkflow).toContain("ref: ${{ github.sha }}");
    expect(qualityWorkflow).not.toContain("paths-ignore:");
    expect(qualityWorkflow).toContain("github.event.before");
    expect(qualityWorkflow).toContain("classify-quality-changes.mjs");
    expect(qualityWorkflow).not.toContain("main-push-context-${{");

    expect(documentationWorkflow).not.toContain("\n    paths:\n");
    expect(documentationWorkflow).toContain("Classify changed files");
    expect(documentationWorkflow).toContain(
      "Documentation checks not required",
    );
    expect(documentationWorkflow).toContain(
      "steps.changes.outputs.documentation == 'true'",
    );

    const orderedQualitySteps = [
      "Check task consistency",
      "Check backend formatting",
      "Run backend lint",
      "Run architecture guardrails",
      "Run documentation guardrails",
      "Run iOS lint and format check",
      "Generate Prisma client",
      "Validate Prisma schema",
      "Build backend",
      "Run unit tests",
      "Run integration tests",
      "Run E2E tests",
    ];
    let previousIndex = -1;
    for (const step of orderedQualitySteps) {
      const index = qualityWorkflow.indexOf(step);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(autoFormatWorkflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(autoFormatWorkflow).toContain("github.event.sender.type != 'Bot'");
    expect(autoFormatWorkflow).toContain("persist-credentials: false");
    expect(autoFormatWorkflow).toContain("github.event.pull_request.head.sha");
    expect(autoFormatWorkflow).toContain("npm run format:write");
    expect(autoFormatWorkflow).toContain("bash scripts/format-ios.sh");
    expect(autoFormatWorkflow).toContain("Verify automatic fixes are stable");
    expect(autoFormatWorkflow).toContain(
      "refusing to push a non-idempotent result",
    );
    expect(autoFormatWorkflow).toContain("AUTO_FIX_APP_ID");
    expect(autoFormatWorkflow).toContain("actions/create-github-app-token@v3");
    expect(autoFormatWorkflow).toContain("permission-contents: write");
    expect(autoFormatWorkflow).toContain(
      'git commit -m "style: apply automatic formatting"',
    );
    expect(autoFormatWorkflow).toContain("git ls-remote --exit-code --refs");
    expect(autoFormatWorkflow).toContain(
      "Pull request advanced, closed, or changed head",
    );
    expect(autoFormatWorkflow).toContain(
      '--force-with-lease="refs/heads/${HEAD_REF}:${EXPECTED_HEAD_SHA}"',
    );
    expect(autoFormatWorkflow).toContain(
      'origin "HEAD:refs/heads/${HEAD_REF}"',
    );
    expect(autoFormatWorkflow).not.toMatch(
      /git push(?:\s|\\\n)*--force(?:\s|$)/,
    );
    expect(autoFormatWorkflow).toContain("gh workflow run quality.yml");
    expect(autoFormatWorkflow).toContain("gh workflow run documentation.yml");
    expect(autoFormatWorkflow).toContain(
      "skipping stale Auto Fix, Quality, and Documentation dispatches",
    );
    expect(autoFormatWorkflow).toContain(
      "github.event.pull_request.draft == false",
    );
    expect(autoFormatWorkflow).toContain("workflow_dispatch:");
    expect(autoFormatWorkflow).toContain("Validate dispatched PR context");
    expect(autoFormatWorkflow).toContain("gh workflow run auto-format.yml");

    expect(deployWorkflow).toContain("workflow_run:");
    expect(deployWorkflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(deployWorkflow).toContain(
      "github.event.workflow_run.event == 'push'",
    );
    expect(deployWorkflow).toContain(
      "github.event.workflow_run.head_branch == 'main'",
    );
    expect(deployWorkflow).toContain(
      "if: github.event_name == 'workflow_dispatch'",
    );
    expect(deployWorkflow).toContain("Resolve deployed Cloud Run SHA");
    expect(deployWorkflow).toContain("DEPLOYED_SHA");
    expect(deployWorkflow).not.toContain("Download originating push range");
    expect(deployWorkflow).toContain("classify-deployment-range.mjs");
    expect(deployWorkflow).not.toContain("${DEPLOY_SHA}^1");
    expect(deployWorkflow).not.toContain("Verify before deployment");
  });

  it("runs only iOS checks for iOS sources and verification scripts", () => {
    expect(
      classifyQualityPaths([
        "ios/Foodfolio/App/FoodfolioApp.swift",
        "scripts/verify-ios.sh",
        "scripts/lint-ios.sh",
        "scripts/format-ios.sh",
      ]),
    ).toEqual({ backend: false, ios: true });
  });

  it("runs only backend checks for backend paths", () => {
    expect(
      classifyQualityPaths([
        "src/api/routes.ts",
        "tests/unit/backend-domain.test.ts",
        "prisma/schema.prisma",
        "package.json",
      ]),
    ).toEqual({ backend: true, ios: false });
  });

  it("runs both checks for mixed backend and iOS changes", () => {
    expect(
      classifyQualityPaths([
        "src/api/routes.ts",
        "ios/Foodfolio/Core/API/APIClient.swift",
      ]),
    ).toEqual({ backend: true, ios: true });
  });

  it("skips code checks for documentation-only changes", () => {
    expect(
      classifyQualityPaths([
        "README.md",
        "docs/dev-flow.md",
        "tasks/todo.md",
        "tasks/completed.md",
      ]),
    ).toEqual({ backend: false, ios: false });
  });

  it("fails safe to backend checks for unknown and shared paths", () => {
    expect(
      classifyQualityPaths([
        ".github/workflows/quality.yml",
        "new-shared-config.json",
      ]),
    ).toEqual({ backend: true, ios: false });
  });

  it("compares the last deployed SHA to the current target", async () => {
    const deployedSha = "a".repeat(40);
    const targetSha = "c".repeat(40);
    const git = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(
      classifyDeploymentRange({
        deployedSha,
        targetSha,
        git,
      }),
    ).resolves.toEqual({
      deploy: true,
      reason: "deployed-to-target range has deployable changes",
    });
    expect(git).toHaveBeenNthCalledWith(2, [
      "diff",
      "--quiet",
      deployedSha,
      targetSha,
      "--",
      "Dockerfile",
      "package.json",
      "package-lock.json",
      "prisma",
      "schemas",
      "src",
    ]);
  });

  it("deploys safely when the deployed SHA cannot be resolved", async () => {
    const git = vi.fn();
    await expect(
      classifyDeploymentRange({
        deployedSha: "",
        targetSha: "c".repeat(40),
        git,
      }),
    ).resolves.toEqual({
      deploy: true,
      reason: "deployed or target SHA is unavailable",
    });
    expect(git).not.toHaveBeenCalled();
  });

  it("skips deployment when deployed and target backend trees match", async () => {
    const git = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await expect(
      classifyDeploymentRange({
        deployedSha: "a".repeat(40),
        targetSha: "c".repeat(40),
        git,
      }),
    ).resolves.toEqual({
      deploy: false,
      reason: "deployed-to-target range has no deployable changes",
    });
  });

  it("deploys safely when the deployed SHA is outside the target ancestry", async () => {
    const git = vi.fn().mockResolvedValueOnce(1);
    await expect(
      classifyDeploymentRange({
        deployedSha: "a".repeat(40),
        targetSha: "c".repeat(40),
        git,
      }),
    ).resolves.toEqual({
      deploy: true,
      reason: "deployed SHA is not a known ancestor of target SHA",
    });
    expect(git).toHaveBeenCalledTimes(1);
  });
});
