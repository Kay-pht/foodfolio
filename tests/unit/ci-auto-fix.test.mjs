import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";
import { getFileInfo } from "prettier";

import { classifyAutomationPaths } from "../../scripts/classify-quality-changes.mjs";
import { selectMarkdownPaths } from "../../scripts/format-changed-markdown.mjs";

describe("CI auto-fix coverage", () => {
  it("keeps local and changed-Markdown Prettier versions aligned", async () => {
    const [packageSource, lockSource, formatterSource] = await Promise.all([
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
      readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
      readFile(
        new URL("../../scripts/format-changed-markdown.mjs", import.meta.url),
        "utf8",
      ),
    ]);
    const packageJson = JSON.parse(packageSource);
    const packageLock = JSON.parse(lockSource);
    const formatterVersion = formatterSource.match(
      /prettier@(\d+\.\d+\.\d+)/,
    )?.[1];

    expect(formatterVersion).toBeDefined();
    expect(packageJson.devDependencies.prettier).toBe(formatterVersion);
    expect(packageLock.packages[""].devDependencies.prettier).toBe(
      formatterVersion,
    );
    expect(packageLock.packages["node_modules/prettier"].version).toBe(
      formatterVersion,
    );
  });

  it("classifies deterministic fix and lightweight validation paths", () => {
    expect(
      classifyAutomationPaths([
        "README.md",
        "infra/terraform/main.tf",
        ".github/workflows/quality.yml",
      ]),
    ).toEqual({
      docs: true,
      documentation: true,
      terraform: true,
      workflows: true,
    });

    expect(classifyAutomationPaths(["package.json"])).toEqual({
      docs: false,
      documentation: true,
      terraform: false,
      workflows: false,
    });
  });

  it("formats changed documentation despite the repository-wide docs ignore", async () => {
    expect(
      selectMarkdownPaths([
        "docs/README.md",
        "src/index.ts",
        "./tasks/todo.md",
        "docs/README.md",
      ]),
    ).toEqual(["docs/README.md", "tasks/todo.md"]);

    await expect(
      getFileInfo("docs/README.md", {
        ignorePath: ".prettierignore.markdown",
      }),
    ).resolves.toMatchObject({ ignored: false, inferredParser: "markdown" });
    await expect(
      getFileInfo("poc/results/evidence.md", {
        ignorePath: ".prettierignore.markdown",
      }),
    ).resolves.toMatchObject({ ignored: true });
  });

  it("serializes ready PR auto-fix and preserves bot, fork, and merge-tree Quality paths", async () => {
    const autoFixWorkflow = await readFile(
      new URL("../../.github/workflows/auto-format.yml", import.meta.url),
      "utf8",
    );
    const qualityWorkflow = await readFile(
      new URL("../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );
    const finalMergeScript = await readFile(
      new URL("../../scripts/pr-final-merge.mjs", import.meta.url),
      "utf8",
    );

    expect(autoFixWorkflow).toContain("name: Auto Fix");
    expect(autoFixWorkflow).toContain("statuses: write");
    expect(autoFixWorkflow).toContain('-f context="Quality Gate"');
    expect(autoFixWorkflow).toContain(
      '-f description="Waiting for Quality validation"',
    );
    expect(autoFixWorkflow).toContain(
      '-f description="Failed to dispatch Quality"',
    );
    expect(autoFixWorkflow).toContain("npm run lint:fix");
    expect(autoFixWorkflow).toContain("npm run prisma:format");
    expect(autoFixWorkflow).toContain(
      "terraform fmt -recursive infra/terraform",
    );
    expect(autoFixWorkflow).toContain(
      "node scripts/format-changed-markdown.mjs --write",
    );
    expect(autoFixWorkflow).toContain("node scripts/sync-task-files.mjs");
    expect(autoFixWorkflow).toContain(
      "github.event.pull_request.draft == false",
    );
    expect(autoFixWorkflow).toContain(
      "github.event.pull_request.user.type != 'Bot'",
    );
    expect(autoFixWorkflow).not.toContain("github.event.sender.type != 'Bot'");
    expect(autoFixWorkflow).toContain(
      "github.event.sender.login != 'kay-pht-auto-fix[bot]'",
    );
    expect(autoFixWorkflow).toContain("handoff-quality:");
    expect(autoFixWorkflow).toContain("github.event.action == 'synchronize'");
    expect(autoFixWorkflow).toContain(
      "github.event.sender.login == 'kay-pht-auto-fix[bot]'",
    );
    expect(autoFixWorkflow).toContain("style: apply automatic formatting");
    expect(autoFixWorkflow).toContain("Dispatch Quality for Auto Fix bot head");
    expect(autoFixWorkflow).toContain("steps.commit.outputs.pushed != 'true'");
    expect(autoFixWorkflow).toContain(
      "Auto Fix GitHub App is required for automatic fix pushes",
    );
    expect(autoFixWorkflow).not.toContain("GITHUB_TOKEN bootstrap fallback");
    expect(
      autoFixWorkflow.match(/gh workflow run quality\.yml/g) ?? [],
    ).toHaveLength(2);
    expect(autoFixWorkflow).not.toContain("gh workflow run documentation.yml");
    expect(autoFixWorkflow).not.toContain("gh workflow run auto-format.yml");
    expect(autoFixWorkflow).toContain("workflow_dispatch:");
    expect(autoFixWorkflow).toContain("Validate dispatched PR context");
    expect(autoFixWorkflow).toContain(
      "Reject remaining fixes on dispatched head",
    );
    expect(autoFixWorkflow).toContain('"${draft}" != "false"');

    const fixJob = autoFixWorkflow.split("\n  handoff-quality:\n")[0];
    const handoffJob = autoFixWorkflow.split("\n  handoff-quality:\n")[1];
    expect(fixJob).toContain(
      "github.event.sender.login != 'kay-pht-auto-fix[bot]'",
    );
    expect(handoffJob).toBeDefined();
    expect(handoffJob).toContain("GH_REPO: ${{ github.repository }}");
    expect(handoffJob).not.toContain("npm run lint:fix");
    expect(handoffJob).not.toContain("actions/checkout");

    expect(qualityWorkflow).toContain("\n  pull_request:\n");
    expect(qualityWorkflow).toContain("statuses: write");
    expect(qualityWorkflow).toContain("Mark Quality Gate running");
    expect(qualityWorkflow).toContain(
      '-f description="Quality validation is running"',
    );
    expect(qualityWorkflow).toContain("Publish Quality Gate result");
    expect(qualityWorkflow).toContain(
      "if: always() && github.event_name == 'workflow_dispatch'",
    );
    expect(qualityWorkflow).toContain("QUALITY_JOB_STATUS: ${{ job.status }}");
    expect(qualityWorkflow).toContain(
      'description="Quality validation passed"',
    );
    expect(qualityWorkflow).toContain(
      'description="Quality validation failed"',
    );
    expect(qualityWorkflow).toContain(
      "github.event.pull_request.head.repo.full_name != github.repository",
    );
    expect(qualityWorkflow).toContain(
      "github.event.pull_request.user.type == 'Bot'",
    );
    expect(qualityWorkflow).toContain(
      "github.event.pull_request.user.login != 'kay-pht-auto-fix[bot]'",
    );
    expect(qualityWorkflow).not.toContain("github.event.sender.type == 'Bot'");
    expect(qualityWorkflow).toContain("'pr-gate-skipped' || 'checks'");
    expect(qualityWorkflow).toContain("workflow_dispatch:");
    expect(qualityWorkflow).toContain("Validate dispatched PR context");
    expect(qualityWorkflow).toContain("Prepare prospective merge tree");
    expect(qualityWorkflow).toContain(
      'git merge --no-commit --no-ff "${QUALITY_HEAD_SHA}"',
    );
    expect(qualityWorkflow).toContain('echo "sha=$(git write-tree)"');
    expect(qualityWorkflow).toContain("github.event.pull_request.base.sha");
    expect(qualityWorkflow).toContain("github.event.pull_request.head.sha");
    expect(qualityWorkflow).toContain("Check task consistency");
    expect(qualityWorkflow).toContain("Run documentation guardrails");
    expect(qualityWorkflow).toContain("Check Markdown formatting");
    expect(qualityWorkflow).toContain(
      "node scripts/format-changed-markdown.mjs --check",
    );

    expect(finalMergeScript).toContain(
      'const QUALITY_WORKFLOW_PATH = ".github/workflows/quality.yml"',
    );
    expect(finalMergeScript).toContain("`quality-proof-${treeSha}`");
    expect(finalMergeScript).toContain("pullRequest.merge_commit_sha");
    expect(finalMergeScript).toContain(
      "mergeCommit.parents?.[0]?.sha !== pullRequest.base?.sha",
    );
    expect(finalMergeScript).toContain(
      "mergeCommit.parents?.[1]?.sha !== expectedHeadSha",
    );
    expect(finalMergeScript).toContain('qualityRun.conclusion === "success"');
    expect(finalMergeScript).toContain(
      "requireSuccessfulQuality(repository, pr.number, proof.reviewed_sha)",
    );
    expect(finalMergeScript).not.toContain('"name,workflow,bucket"');
  });
});
