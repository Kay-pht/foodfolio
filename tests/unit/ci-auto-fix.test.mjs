import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";
import { getFileInfo } from "prettier";

import { classifyAutomationPaths } from "../../scripts/classify-quality-changes.mjs";
import { selectMarkdownPaths } from "../../scripts/format-changed-markdown.mjs";

describe("CI auto-fix coverage", () => {
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

  it("keeps automatic fixes deterministic and re-verifies the fixed head", async () => {
    const autoFixWorkflow = await readFile(
      new URL("../../.github/workflows/auto-format.yml", import.meta.url),
      "utf8",
    );
    const qualityWorkflow = await readFile(
      new URL("../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );
    const documentationWorkflow = await readFile(
      new URL("../../.github/workflows/documentation.yml", import.meta.url),
      "utf8",
    );

    expect(autoFixWorkflow).toContain("name: Auto Fix");
    expect(autoFixWorkflow).toContain("npm run lint:fix");
    expect(autoFixWorkflow).toContain("npm run prisma:format");
    expect(autoFixWorkflow).toContain(
      "terraform fmt -recursive infra/terraform",
    );
    expect(autoFixWorkflow).toContain(
      "node scripts/format-changed-markdown.mjs --write",
    );
    expect(autoFixWorkflow).toContain("node scripts/sync-task-files.mjs");
    expect(autoFixWorkflow).toContain("gh workflow run quality.yml");
    expect(autoFixWorkflow).toContain("gh workflow run documentation.yml");
    expect(autoFixWorkflow).toContain("workflow_dispatch:");
    expect(autoFixWorkflow).toContain("Validate dispatched PR context");
    expect(autoFixWorkflow).toContain(
      "Reject remaining fixes on dispatched head",
    );
    expect(autoFixWorkflow).toContain("gh workflow run auto-format.yml");
    expect(autoFixWorkflow).toContain("verify-{0}");

    expect(qualityWorkflow).toContain("Check whitespace and conflict markers");
    expect(qualityWorkflow).toContain("git diff --check");
    expect(qualityWorkflow).toContain("rhysd/actionlint:1.7.12");
    expect(qualityWorkflow).toContain("Check Terraform formatting");
    expect(qualityWorkflow).toContain("terraform fmt -check -recursive");
    expect(qualityWorkflow).toContain("Check Prisma formatting");
    expect(qualityWorkflow).toContain(
      "git diff --exit-code -- prisma/schema.prisma",
    );
    expect(qualityWorkflow).toContain("Check Markdown formatting");
    expect(qualityWorkflow).toContain(
      "node scripts/format-changed-markdown.mjs --check",
    );

    expect(documentationWorkflow).toContain("workflow_dispatch:");
    expect(documentationWorkflow).toContain("Validate dispatched PR context");
    expect(documentationWorkflow).toContain("Check task consistency");
    expect(documentationWorkflow).toContain("stale-dispatch-{0}");
    expect(documentationWorkflow).toContain(
      "node scripts/format-changed-markdown.mjs --check",
    );
  });
});
