import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const workerEnvironment = {
  DATABASE_URL: "postgresql://localhost/foodfolio",
  ZAI_API_KEY: "test-zai-key",
  YOUTUBE_API_KEY: "test-youtube-key",
};

describe("Instagram video fallback environment", () => {
  it("is disabled by default and uses five total download attempts", () => {
    const config = loadConfig("worker", workerEnvironment);

    expect(config.instagramVideoFallbackEnabled).toBe(false);
    expect(config.instagramVideoBucket).toBe("");
    expect(config.instagramVideoMaxAttempts).toBe(5);
  });

  it("requires a private media bucket when enabled", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        INSTAGRAM_VIDEO_FALLBACK_ENABLED: "true",
      }),
    ).toThrow(
      "INSTAGRAM_VIDEO_BUCKET is required when Instagram video fallback is enabled",
    );
  });

  it("accepts an enabled configuration with an explicit bucket", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      INSTAGRAM_VIDEO_FALLBACK_ENABLED: "true",
      INSTAGRAM_VIDEO_BUCKET: "foodfolio-dev-temporary-media",
    });

    expect(config.instagramVideoFallbackEnabled).toBe(true);
    expect(config.instagramVideoBucket).toBe("foodfolio-dev-temporary-media");
  });

  it("caps whole download attempts at five", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        INSTAGRAM_VIDEO_MAX_ATTEMPTS: "6",
      }),
    ).toThrow(
      "INSTAGRAM_VIDEO_MAX_ATTEMPTS must be an integer from 1 to 5",
    );
  });
});
