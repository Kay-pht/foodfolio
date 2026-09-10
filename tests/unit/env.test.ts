import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const workerEnvironment = {
  DATABASE_URL: "postgresql://localhost/foodfolio",
  ZAI_API_KEY: "test-zai-key",
  YOUTUBE_API_KEY: "test-youtube-key",
};

const cloudApiEnvironment = {
  DATABASE_URL: "postgresql://localhost/foodfolio",
  WORKER_URL: "https://worker.example",
  YOUTUBE_API_KEY: "test-youtube-key",
  GCP_PROJECT_ID: "project",
  CLOUD_TASKS_LOCATION: "region",
  CLOUD_TASKS_QUEUE: "queue",
  TASK_INVOKER_SERVICE_ACCOUNT: "worker@example.iam.gserviceaccount.com",
};

describe("backend environment drivers", () => {
  it("keeps Cloud Tasks and Firebase notifications as the defaults", () => {
    const apiConfig = loadConfig("api", cloudApiEnvironment);
    const workerConfig = loadConfig("worker", workerEnvironment);

    expect(apiConfig.analysisQueueDriver).toBe("cloud-tasks");
    expect(workerConfig.notificationDriver).toBe("firebase");
  });

  it("requires YouTube metadata access for API image resolution", () => {
    expect(() =>
      loadConfig("api", {
        ...cloudApiEnvironment,
        YOUTUBE_API_KEY: "",
      }),
    ).toThrow("Missing environment variables: YOUTUBE_API_KEY");
  });

  it("allows the local HTTP queue without Cloud Tasks configuration", () => {
    const config = loadConfig("api", {
      DATABASE_URL: "postgresql://localhost/foodfolio",
      WORKER_URL: "http://127.0.0.1:8081",
      YOUTUBE_API_KEY: "test-youtube-key",
      ANALYSIS_QUEUE_DRIVER: "local-http",
    });

    expect(config.analysisQueueDriver).toBe("local-http");
    expect(config.gcpProjectId).toBe("");
  });

  it("allows notifications to be disabled for local workers", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      NOTIFICATION_DRIVER: "noop",
    });

    expect(config.notificationDriver).toBe("noop");
  });

  it("rejects unsupported local driver values", () => {
    expect(() =>
      loadConfig("api", {
        DATABASE_URL: "postgresql://localhost/foodfolio",
        WORKER_URL: "http://127.0.0.1:8081",
        YOUTUBE_API_KEY: "test-youtube-key",
        ANALYSIS_QUEUE_DRIVER: "memory",
      }),
    ).toThrow("ANALYSIS_QUEUE_DRIVER must be cloud-tasks or local-http");
  });
});

describe("TikTok media analysis environment", () => {
  it("is disabled by default and uses five total download attempts", () => {
    const config = loadConfig("worker", workerEnvironment);

    expect(config.tiktokMediaAnalysisEnabled).toBe(false);
    expect(config.tiktokVideoMaxAttempts).toBe(5);
    expect(config.tiktokVideoBucket).toBe("");
  });

  it("requires a private video bucket when enabled", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        TIKTOK_MEDIA_ANALYSIS_ENABLED: "true",
      }),
    ).toThrow(
      "TIKTOK_VIDEO_BUCKET is required when TikTok media analysis is enabled",
    );
  });

  it("accepts an enabled configuration with an explicit bucket", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      TIKTOK_MEDIA_ANALYSIS_ENABLED: "true",
      TIKTOK_VIDEO_BUCKET: "foodfolio-dev-tiktok-video-fallback",
    });

    expect(config.tiktokMediaAnalysisEnabled).toBe(true);
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

describe("YouTube Gemini fallback environment", () => {
  it("is disabled by default", () => {
    const config = loadConfig("worker", workerEnvironment);

    expect(config.youtubeGeminiFallbackEnabled).toBe(false);
    expect(config.geminiApiKey).toBe("");
  });

  it("loads the enable flag and API key without exposing them elsewhere", () => {
    const config = loadConfig("worker", {
      ...workerEnvironment,
      YOUTUBE_GEMINI_FALLBACK_ENABLED: "true",
      GEMINI_API_KEY: "test-gemini-key",
    });

    expect(config.youtubeGeminiFallbackEnabled).toBe(true);
    expect(config.geminiApiKey).toBe("test-gemini-key");
  });

  it("rejects an invalid enable flag", () => {
    expect(() =>
      loadConfig("worker", {
        ...workerEnvironment,
        YOUTUBE_GEMINI_FALLBACK_ENABLED: "yes",
      }),
    ).toThrow("YOUTUBE_GEMINI_FALLBACK_ENABLED must be true or false");
  });
});
