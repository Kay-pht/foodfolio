import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  findReusableQualityRunId,
  isReusableQualityRun,
} from "../../scripts/find-reusable-quality-proof.mjs";
import { classifyDeploymentRange } from "../../scripts/classify-deployment-range.mjs";

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
    expect(qualityWorkflow).toContain("run: npm run verify");
    expect(deployWorkflow).toContain("workflow_run:");
    expect(deployWorkflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(deployWorkflow).toContain(
      "if: github.event_name == 'workflow_dispatch'",
    );
    expect(qualityWorkflow).toContain("github.event.before");
    expect(qualityWorkflow).toContain("main-push-context-${{");
    expect(deployWorkflow).toContain("Download originating push range");
    expect(deployWorkflow).toContain("classify-deployment-range.mjs");
    expect(deployWorkflow).not.toContain("${DEPLOY_SHA}^1");
    expect(deployWorkflow).not.toContain("Verify before deployment");
  });

  it("compares the complete before-to-after push range", async () => {
    const beforeSha = "a".repeat(40);
    const afterSha = "c".repeat(40);
    const git = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(
      classifyDeploymentRange({
        beforeSha,
        afterSha,
        expectedAfterSha: afterSha,
        git,
      }),
    ).resolves.toEqual({
      deploy: true,
      reason: "push range has deployable changes",
    });
    expect(git).toHaveBeenNthCalledWith(2, [
      "diff",
      "--quiet",
      beforeSha,
      afterSha,
      "--",
      "Dockerfile",
      "package.json",
      "package-lock.json",
      "prisma",
      "schemas",
      "src",
    ]);
  });

  it("deploys safely when the recorded range does not match the Quality SHA", async () => {
    const git = vi.fn();
    await expect(
      classifyDeploymentRange({
        beforeSha: "a".repeat(40),
        afterSha: "b".repeat(40),
        expectedAfterSha: "c".repeat(40),
        git,
      }),
    ).resolves.toEqual({
      deploy: true,
      reason: "invalid or mismatched push range",
    });
    expect(git).not.toHaveBeenCalled();
  });
});
