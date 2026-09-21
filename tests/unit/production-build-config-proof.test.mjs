import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const buildConfig = JSON.parse(
  await readFile(new URL("../../tsconfig.build.json", import.meta.url), "utf8"),
);
const terraform = await readFile(
  new URL("../../infra/terraform/main.tf", import.meta.url),
  "utf8",
);
const workerStart = terraform.indexOf(
  'resource "google_cloud_run_v2_service" "worker"',
);
const workerEnd = terraform.indexOf(
  'resource "google_cloud_run_v2_service_iam_member" "task_invokes_worker"',
);
const apiStart = terraform.indexOf(
  'resource "google_cloud_run_v2_service" "api"',
);
const workerBlock = terraform.slice(workerStart, workerEnd);
const apiBlock = terraform.slice(apiStart);

describe("production TypeScript build boundary", () => {
  it("does not compile PoC sources that depend on ignored local evidence", () => {
    expect(buildConfig.exclude).toContain("poc");
  });

  it("continues to exclude test sources from the production build", () => {
    expect(buildConfig.exclude).toContain("tests");
  });
});

describe("Jev production deployment proof", () => {
  it("injects the TypeSafe secret only into the Worker", () => {
    expect(workerBlock).toContain('name = "TYPESAFE_API_KEY"');
    expect(workerBlock).toContain(
      'google_secret_manager_secret.app["foodfolio-dev-typesafe-api-key"]',
    );
    expect(apiBlock).not.toContain('name = "TYPESAFE_API_KEY"');
  });

  it("keeps all production media routes enabled", () => {
    for (const name of [
      "YOUTUBE_GEMINI_FALLBACK_ENABLED",
      "INSTAGRAM_MEDIA_FALLBACK_ENABLED",
      "TIKTOK_MEDIA_ANALYSIS_ENABLED",
    ]) {
      expect(workerBlock).toMatch(
        new RegExp(`name\\s*=\\s*"${name}"[\\s\\S]{0,120}value\\s*=\\s*"true"`),
      );
    }
  });

  it("injects every source-specific Jev threshold into the Worker", () => {
    for (const name of [
      "JEV_GENERAL_WEB_NON_RECIPE_THRESHOLD",
      "JEV_YOUTUBE_RECIPE_THRESHOLD",
      "JEV_INSTAGRAM_RECIPE_THRESHOLD",
      "JEV_TIKTOK_VIDEO_RECIPE_THRESHOLD",
      "JEV_TIKTOK_PHOTO_RECIPE_THRESHOLD",
      "JEV_AI_CHAT_NON_RECIPE_THRESHOLD",
    ]) {
      expect(workerBlock).toContain(`name  = "${name}"`);
    }
  });
});
