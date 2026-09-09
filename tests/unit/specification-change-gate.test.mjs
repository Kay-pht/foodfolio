import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { classifySpecificationPaths } from "../../scripts/classify-quality-changes.mjs";

describe("Specification change gate", () => {
  it("requires specs for production behavior paths", () => {
    expect(classifySpecificationPaths(["src/api/routes.ts"])).toEqual({
      spec_required: true,
    });
    expect(classifySpecificationPaths(["prisma/schema.prisma"])).toEqual({
      spec_required: true,
    });
    expect(
      classifySpecificationPaths([
        "ios/Foodfolio/Features/Recipe/RecipeDetailView.swift",
      ]),
    ).toEqual({ spec_required: true });
    expect(
      classifySpecificationPaths([
        "ios/FoodfolioShareExtension/ShareViewController.swift",
      ]),
    ).toEqual({ spec_required: true });
    expect(classifySpecificationPaths(["ios/project.yml"])).toEqual({
      spec_required: true,
    });
    expect(
      classifySpecificationPaths(["infra/terraform/main.tf"]),
    ).toEqual({ spec_required: true });
  });

  it("does not require specs for tests, CI, docs, or tooling alone", () => {
    expect(
      classifySpecificationPaths([
        "tests/unit/backend-domain.test.ts",
        "ios/FoodfolioTests/RecipeTests.swift",
        ".github/workflows/quality.yml",
        "docs/agent/testing.md",
        "scripts/check-docs.mjs",
      ]),
    ).toEqual({ spec_required: false });
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
