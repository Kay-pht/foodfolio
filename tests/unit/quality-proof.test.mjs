import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  findReusableQualityRunId,
  isReusableQualityRun,
} from "../../scripts/find-reusable-quality-proof.mjs";
import { classifyDeploymentRange } from "../../scripts/classify-deployment-range.mjs";
import { classifyQualityPaths } from "../../scripts/classify-quality-changes.mjs";

const repository = "Kay-pht/foodfolio";
const validRun = {
  conclusion: "success",
  event: "pull_request",
  name: "Quality",
  path: ".github/workflows/quality.yml",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};

describe("PR Quality proof", () => {
  it("accepts only successful Quality runs from a same-repository PR", () => {
    expect(isReusableQualityRun(validRun, repository)).toBe(true);
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

  it("keeps deploy gated by main Quality and verifies manual deploys", async () => {
    const qualityWorkflow = await readFile(
      new URL("../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );
    const deployWorkflow = await readFile(
      new URL("../../.github/workflows/deploy-dev.yml", import.meta.url),
      "utf8",
    );

    expect(qualityWorkflow).toContain("quality-proof-${{");
    expect(qualityWorkflow).toContain("Run backend Quality checks");
    expect(qualityWorkflow).toContain("run: npm run verify");
    expect(qualityWorkflow).toContain("Run iOS lint and format check");
    expect(qualityWorkflow).toContain("swift:6.3@sha256:");
    expect(qualityWorkflow).not.toContain("runs-on: macos-");
    expect(qualityWorkflow).toContain("paths-ignore:");
    expect(qualityWorkflow).toContain('- "*.md"');
    expect(qualityWorkflow).toContain('- "**/*.md"');
    expect(qualityWorkflow).toContain('- "docs/**"');
    expect(deployWorkflow).toContain("workflow_run:");
    expect(deployWorkflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(deployWorkflow).toContain(
      "if: github.event_name == 'workflow_dispatch'",
    );
    expect(qualityWorkflow).toContain("github.event.before");
    expect(qualityWorkflow).toContain("classify-quality-changes.mjs");
    expect(qualityWorkflow).not.toContain("main-push-context-${{");
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
      classifyQualityPaths(["README.md", "docs/dev-flow.md", "todo.md"]),
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
