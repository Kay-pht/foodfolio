const REQUIRED_BY_ROLE = {
  api: ["DATABASE_URL", "WORKER_URL"],
  worker: ["DATABASE_URL", "ZAI_API_KEY", "YOUTUBE_API_KEY"],
} as const;

const CLOUD_TASKS_REQUIRED = [
  "GCP_PROJECT_ID",
  "CLOUD_TASKS_LOCATION",
  "CLOUD_TASKS_QUEUE",
  "TASK_INVOKER_SERVICE_ACCOUNT",
] as const;

export type AppRole = keyof typeof REQUIRED_BY_ROLE;
export type AnalysisQueueDriver = "cloud-tasks" | "local-http";
export type NotificationDriver = "firebase" | "noop";

export interface AppConfig {
  appEnv: string;
  databaseUrl: string;
  gcpProjectId: string;
  cloudTasksLocation: string;
  cloudTasksQueue: string;
  workerUrl: string;
  taskInvokerServiceAccount: string;
  analysisQueueDriver: AnalysisQueueDriver;
  notificationDriver: NotificationDriver;
  zaiApiKey: string;
  youtubeApiKey: string;
  geminiApiKey: string;
  aiModel: string;
  maxAnalysisAttempts: number;
  tiktokVideoFallbackEnabled: boolean;
  youtubeGeminiFallbackEnabled: boolean;
  tiktokVideoBucket: string;
  tiktokVideoMaxAttempts: number;
  instagramMediaFallbackEnabled: boolean;
  instagramMediaBucket: string;
  instagramMediaMaxAttempts: number;
  ytDlpPath: string;
  port: number;
}

export function loadConfig(role: AppRole, source = process.env): AppConfig {
  const analysisQueueDriver = parseAnalysisQueueDriver(
    source.ANALYSIS_QUEUE_DRIVER ?? "cloud-tasks",
  );
  const notificationDriver = parseNotificationDriver(
    source.NOTIFICATION_DRIVER ?? "firebase",
  );
  const required = [
    ...REQUIRED_BY_ROLE[role],
    ...(role === "api" && analysisQueueDriver === "cloud-tasks"
      ? CLOUD_TASKS_REQUIRED
      : []),
  ];
  const missing = required.filter((key) => !source[key]?.trim());
  if (missing.length > 0)
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  const maxAnalysisAttempts = Number(source.MAX_ANALYSIS_ATTEMPTS ?? "3");
  if (!Number.isInteger(maxAnalysisAttempts) || maxAnalysisAttempts < 1) {
    throw new Error("MAX_ANALYSIS_ATTEMPTS must be a positive integer");
  }
  const tiktokVideoFallbackEnabled = parseBoolean(
    "TIKTOK_VIDEO_FALLBACK_ENABLED",
    source.TIKTOK_VIDEO_FALLBACK_ENABLED ?? "false",
  );
  const youtubeGeminiFallbackEnabled = parseBoolean(
    "YOUTUBE_GEMINI_FALLBACK_ENABLED",
    source.YOUTUBE_GEMINI_FALLBACK_ENABLED ?? "false",
  );
  const tiktokVideoBucket = source.TIKTOK_VIDEO_BUCKET?.trim() ?? "";
  if (tiktokVideoFallbackEnabled && !tiktokVideoBucket)
    throw new Error(
      "TIKTOK_VIDEO_BUCKET is required when TikTok video fallback is enabled",
    );
  const tiktokVideoMaxAttempts = Number(
    source.TIKTOK_VIDEO_MAX_ATTEMPTS ?? "5",
  );
  if (
    !Number.isInteger(tiktokVideoMaxAttempts) ||
    tiktokVideoMaxAttempts < 1 ||
    tiktokVideoMaxAttempts > 5
  )
    throw new Error("TIKTOK_VIDEO_MAX_ATTEMPTS must be an integer from 1 to 5");

  const instagramMediaFallbackEnabled = parseBoolean(
    "INSTAGRAM_MEDIA_FALLBACK_ENABLED",
    source.INSTAGRAM_MEDIA_FALLBACK_ENABLED ??
      source.INSTAGRAM_VIDEO_FALLBACK_ENABLED ??
      "false",
  );
  const instagramMediaBucket =
    source.INSTAGRAM_MEDIA_BUCKET?.trim() ??
    source.INSTAGRAM_VIDEO_BUCKET?.trim() ??
    "";
  if (instagramMediaFallbackEnabled && !instagramMediaBucket)
    throw new Error(
      "INSTAGRAM_MEDIA_BUCKET is required when Instagram media fallback is enabled",
    );
  const instagramMediaMaxAttempts = Number(
    source.INSTAGRAM_MEDIA_MAX_ATTEMPTS ??
      source.INSTAGRAM_VIDEO_MAX_ATTEMPTS ??
      "5",
  );
  if (
    !Number.isInteger(instagramMediaMaxAttempts) ||
    instagramMediaMaxAttempts < 1 ||
    instagramMediaMaxAttempts > 5
  )
    throw new Error(
      "INSTAGRAM_MEDIA_MAX_ATTEMPTS must be an integer from 1 to 5",
    );

  return {
    appEnv: source.APP_ENV ?? "development",
    databaseUrl: source.DATABASE_URL ?? "",
    gcpProjectId: source.GCP_PROJECT_ID ?? "",
    cloudTasksLocation: source.CLOUD_TASKS_LOCATION ?? "asia-southeast1",
    cloudTasksQueue: source.CLOUD_TASKS_QUEUE ?? "recipe-analysis",
    workerUrl: source.WORKER_URL ?? "",
    taskInvokerServiceAccount: source.TASK_INVOKER_SERVICE_ACCOUNT ?? "",
    analysisQueueDriver,
    notificationDriver,
    zaiApiKey: source.ZAI_API_KEY ?? "",
    youtubeApiKey: source.YOUTUBE_API_KEY ?? "",
    geminiApiKey: source.GEMINI_API_KEY ?? "",
    aiModel: source.AI_MODEL ?? "glm-5.3-flash",
    maxAnalysisAttempts,
    tiktokVideoFallbackEnabled,
    youtubeGeminiFallbackEnabled,
    tiktokVideoBucket,
    tiktokVideoMaxAttempts,
    instagramMediaFallbackEnabled,
    instagramMediaBucket,
    instagramMediaMaxAttempts,
    ytDlpPath: source.YT_DLP_PATH ?? "/usr/local/bin/yt-dlp",
    port: Number(source.PORT ?? "8080"),
  };
}

function parseAnalysisQueueDriver(value: string): AnalysisQueueDriver {
  if (value === "cloud-tasks" || value === "local-http") return value;
  throw new Error("ANALYSIS_QUEUE_DRIVER must be cloud-tasks or local-http");
}

function parseNotificationDriver(value: string): NotificationDriver {
  if (value === "firebase" || value === "noop") return value;
  throw new Error("NOTIFICATION_DRIVER must be firebase or noop");
}

function parseBoolean(name: string, value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
