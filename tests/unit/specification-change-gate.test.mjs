import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { classifySpecificationPaths } from "../../scripts/classify-quality-changes.mjs";

describe("Specification change gate", () => {
  it("requires specs for implementation and automation behavior paths", () => {
    const behaviorPaths = [
      "src/api/routes.ts",
      "prisma/schema.prisma",
      "ios/Foodfolio/Features/Recipe/RecipeDetailView.swift",
      "ios/FoodfolioShareExtension/ShareViewController.swift",
      "ios/project.yml",
      "infra/terraform/main.tf",
      ".github/workflows/quality.yml",
      "scripts/check-docs.mjs",
      "package.json",
      "new-shared-config.json",
    ];

    for (const path of behaviorPaths) {
      expect(classifySpecificationPaths([path])).toEqual({
        spec_required: true,
      });
    }
  });

  it("exempts only mechanically non-behavior paths", () => {
    const exemptPaths = [
      "tests/unit/backend-domain.test.ts",
      "ios/FoodfolioTests/RecipeTests.swift",
      "ios/FoodfolioIntegrationTests/APIClientTests.swift",
      "ios/FoodfolioUITests/RecipeUITests.swift",
      "docs/agent/testing.md",
      "specs/tasks/TASK-001.yaml",
      ".gitignore",
      ".prettierignore",
      ".swift-format",
      ".vscode/settings.json",
    ];

    for (const path of exemptPaths) {
      expect(classifySpecificationPaths([path])).toEqual({
        spec_required: false,
      });
    }
  });

  it("wires the change gate and exact PR range into Quality", async () => {
    const qualityWorkflow = await readFile(
      new URL("../../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );

    expect(qualityWorkflow).toContain("Check specification change gate");
    expect(qualityWorkflow).toContain(
      "steps.changes.outputs.spec_required == 'true'",
    );
    expect(qualityWorkflow).toContain("SPEC_BASE_SHA:");
    expect(qualityWorkflow).toContain("SPEC_HEAD_SHA:");
    expect(qualityWorkflow).toContain("node scripts/check-spec-change.mjs");
  });
});
