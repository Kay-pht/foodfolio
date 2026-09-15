import { describe, expect, it, vi } from "vitest";

import {
  findSuccessfulQualityRunId,
  isSuccessfulQualityRunForPr,
  resolveCurrentMergeTree,
} from "../../scripts/pr-final-merge.mjs";

const repository = "Kay-pht/foodfolio";
const prNumber = 102;
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const treeSha = "c".repeat(40);
const mergeCommitSha = "d".repeat(40);

const pullRequest = {
  state: "open",
  draft: false,
  merge_commit_sha: mergeCommitSha,
  head: { sha: headSha },
  base: { sha: baseSha },
};
const mergeCommit = {
  sha: mergeCommitSha,
  parents: [{ sha: baseSha }, { sha: headSha }],
  tree: { sha: treeSha },
};
const successfulDispatchRun = {
  status: "completed",
  conclusion: "success",
  event: "workflow_dispatch",
  name: "Quality",
  path: ".github/workflows/quality.yml",
  repository: { full_name: repository },
  head_sha: headSha,
  pull_requests: [{ number: prNumber, head: { sha: headSha } }],
};

describe("PR final merge Quality gate", () => {
  it("resolves the exact current GitHub merge-preview tree", () => {
    expect(resolveCurrentMergeTree(pullRequest, mergeCommit, headSha)).toBe(
      treeSha,
    );
  });

  it("rejects a stale merge preview whose base or head no longer matches", () => {
    expect(() =>
      resolveCurrentMergeTree(
        pullRequest,
        {
          ...mergeCommit,
          parents: [{ sha: "e".repeat(40) }, { sha: headSha }],
        },
        headSha,
      ),
    ).toThrow(/merge preview is stale/);
    expect(() =>
      resolveCurrentMergeTree(
        { ...pullRequest, head: { sha: "f".repeat(40) } },
        mergeCommit,
        headSha,
      ),
    ).toThrow(/PR HEAD changed/);
  });

  it("accepts only successful Quality runs associated with the current PR head", () => {
    expect(
      isSuccessfulQualityRunForPr(successfulDispatchRun, {
        repository,
        prNumber,
        headSha,
      }),
    ).toBe(true);
    expect(
      isSuccessfulQualityRunForPr(
        { ...successfulDispatchRun, head_sha: "e".repeat(40) },
        { repository, prNumber, headSha },
      ),
    ).toBe(false);
    expect(
      isSuccessfulQualityRunForPr(
        { ...successfulDispatchRun, conclusion: "failure" },
        { repository, prNumber, headSha },
      ),
    ).toBe(false);
  });

  it("also accepts successful direct pull_request Quality for the current PR", () => {
    expect(
      isSuccessfulQualityRunForPr(
        {
          ...successfulDispatchRun,
          event: "pull_request",
          head_sha: mergeCommitSha,
        },
        { repository, prNumber, headSha },
      ),
    ).toBe(true);
  });

  it("binds the merge gate to the exact-tree proof artifact and its run", () => {
    const runId = 34916528435;
    const loadRun = vi.fn(() => successfulDispatchRun);
    const result = findSuccessfulQualityRunId({
      artifacts: [
        {
          id: 11,
          name: `quality-proof-${"e".repeat(40)}`,
          expired: false,
          workflow_run: { id: 1 },
        },
        {
          id: 12,
          name: `quality-proof-${treeSha}`,
          expired: false,
          workflow_run: { id: runId },
        },
      ],
      loadRun,
      repository,
      prNumber,
      headSha,
      treeSha,
    });

    expect(result).toBe(runId);
    expect(loadRun).toHaveBeenCalledOnce();
    expect(loadRun).toHaveBeenCalledWith(runId);
  });

  it("fails closed when only stale, expired, or unsuccessful proof artifacts exist", () => {
    const loadRun = vi.fn(() => ({
      ...successfulDispatchRun,
      conclusion: "failure",
    }));
    const result = findSuccessfulQualityRunId({
      artifacts: [
        {
          id: 12,
          name: `quality-proof-${treeSha}`,
          expired: true,
          workflow_run: { id: 2 },
        },
        {
          id: 13,
          name: `quality-proof-${treeSha}`,
          expired: false,
          workflow_run: { id: 3 },
        },
      ],
      loadRun,
      repository,
      prNumber,
      headSha,
      treeSha,
    });

    expect(result).toBeUndefined();
    expect(loadRun).toHaveBeenCalledOnce();
    expect(loadRun).toHaveBeenCalledWith(3);
  });
});
