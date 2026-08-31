import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const workerEnvironment = {
  DATABASE_URL: "postgresql://localhost/foodfolio",
  ZAI_API_KEY: "test-zai-key",
  YOUTUBE_API_KEY: "test-youtube-key",
};

describe("TikTok video fallback environment", () => {
  it("is disabled by default and uses five total download attempts", () => {
    const config = loadConfig("worker", workerEnvironment);

    expect(config.tiktokVideoFallbackEnabled).toBe(false);
    expect(config.tiktokVideoMaxAttempts).toBe(5);
    expect(config.tiktokVideoBucket).toBe("");
  });

  it("requires a private video bucket when enabled", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        TIKTOK_VIDEO_FALLBACK_ENABLED: "true",
      }),
    ).toThrow(
      "TIKTOK_VIDEO_BUCKET is required when TikTok video fallback is enabled",
    );
  });

  it("accepts an enabled configuration with an explicit bucket", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      TIKTOK_VIDEO_FALLBACK_ENABLED: "true",
      TIKTOK_VIDEO_BUCKET: "foodfolio-dev-tiktok-video-fallback",
    });

    expect(config.tiktokVideoFallbackEnabled).toBe(true);
    expect(config.tiktokVideoBucket).toBe(
      "foodfolio-dev-tiktok-video-fallback",
    );
  });

  it("does not allow Cloud Tasks deliveries to raise the five-attempt cap", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        TIKTOK_VIDEO_MAX_ATTEMPTS: "6",
      }),
    ).toThrow("TIKTOK_VIDEO_MAX_ATTEMPTS must be an integer from 1 to 5");
  });
});
