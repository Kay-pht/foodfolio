import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const workerEnvironment = {
  DATABASE_URL: "postgresql://localhost/foodfolio",
  ZAI_API_KEY: "test-zai-key",
  TYPESAFE_API_KEY: "test-typesafe-key",
  YOUTUBE_API_KEY: "test-youtube-key",
};

describe("Instagram media fallback environment", () => {
  it("is disabled by default and uses five total retrieval attempts", () => {
    const config = loadConfig("worker", workerEnvironment);

    expect(config.instagramMediaFallbackEnabled).toBe(false);
    expect(config.instagramMediaBucket).toBe("");
    expect(config.instagramMediaMaxAttempts).toBe(5);
  });

  it("requires a private media bucket when enabled", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        INSTAGRAM_MEDIA_FALLBACK_ENABLED: "true",
      }),
    ).toThrow(
      "INSTAGRAM_MEDIA_BUCKET is required when Instagram media fallback is enabled",
    );
  });

  it("accepts an enabled configuration with an explicit bucket", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      INSTAGRAM_MEDIA_FALLBACK_ENABLED: "true",
      INSTAGRAM_MEDIA_BUCKET: "foodfolio-dev-temporary-media",
    });

    expect(config.instagramMediaFallbackEnabled).toBe(true);
    expect(config.instagramMediaBucket).toBe("foodfolio-dev-temporary-media");
  });

  it("accepts the PR2 video-named variables during the rollout transition", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      INSTAGRAM_VIDEO_FALLBACK_ENABLED: "true",
      INSTAGRAM_VIDEO_BUCKET: "foodfolio-dev-temporary-media",
      INSTAGRAM_VIDEO_MAX_ATTEMPTS: "4",
    });

    expect(config.instagramMediaFallbackEnabled).toBe(true);
    expect(config.instagramMediaBucket).toBe("foodfolio-dev-temporary-media");
    expect(config.instagramMediaMaxAttempts).toBe(4);
  });

  it("caps whole retrieval attempts at five", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        INSTAGRAM_MEDIA_MAX_ATTEMPTS: "6",
      }),
    ).toThrow("INSTAGRAM_MEDIA_MAX_ATTEMPTS must be an integer from 1 to 5");
  });
});
