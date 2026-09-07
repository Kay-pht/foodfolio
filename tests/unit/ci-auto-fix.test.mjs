import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { classifyAutomationPaths } from "../../scripts/classify-quality-changes.mjs";

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
    expect(autoFixWorkflow).toContain('prettier@3.6.2 --write "**/*.md"');
    expect(autoFixWorkflow).toContain("node scripts/sync-task-files.mjs");
    expect(autoFixWorkflow).toContain("gh workflow run quality.yml");
    expect(autoFixWorkflow).toContain("gh workflow run documentation.yml");
    expect(autoFixWorkflow).not.toContain("\n  workflow_dispatch:\n");

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

    expect(documentationWorkflow).toContain("workflow_dispatch:");
    expect(documentationWorkflow).toContain("Validate dispatched PR context");
    expect(documentationWorkflow).toContain("Check task consistency");
  });
});
