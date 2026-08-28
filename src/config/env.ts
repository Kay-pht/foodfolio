const REQUIRED_BY_ROLE = {
  api: [
    "DATABASE_URL",
    "GCP_PROJECT_ID",
    "CLOUD_TASKS_LOCATION",
    "CLOUD_TASKS_QUEUE",
    "WORKER_URL",
    "TASK_INVOKER_SERVICE_ACCOUNT",
  ],
  worker: ["DATABASE_URL", "ZAI_API_KEY", "YOUTUBE_API_KEY"],
} as const;

export type AppRole = keyof typeof REQUIRED_BY_ROLE;

export interface AppConfig {
  appEnv: string;
  databaseUrl: string;
  gcpProjectId: string;
  cloudTasksLocation: string;
  cloudTasksQueue: string;
  workerUrl: string;
  taskInvokerServiceAccount: string;
  zaiApiKey: string;
  youtubeApiKey: string;
  aiModel: string;
  maxAnalysisAttempts: number;
  port: number;
}

export function loadConfig(role: AppRole, source = process.env): AppConfig {
  const missing = REQUIRED_BY_ROLE[role].filter((key) => !source[key]?.trim());
  if (missing.length > 0)
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  const maxAnalysisAttempts = Number(source.MAX_ANALYSIS_ATTEMPTS ?? "3");
  if (!Number.isInteger(maxAnalysisAttempts) || maxAnalysisAttempts < 1) {
    throw new Error("MAX_ANALYSIS_ATTEMPTS must be a positive integer");
  }
  return {
    appEnv: source.APP_ENV ?? "development",
    databaseUrl: source.DATABASE_URL ?? "",
    gcpProjectId: source.GCP_PROJECT_ID ?? "",
    cloudTasksLocation: source.CLOUD_TASKS_LOCATION ?? "asia-southeast1",
    cloudTasksQueue: source.CLOUD_TASKS_QUEUE ?? "recipe-analysis",
    workerUrl: source.WORKER_URL ?? "",
    taskInvokerServiceAccount: source.TASK_INVOKER_SERVICE_ACCOUNT ?? "",
    zaiApiKey: source.ZAI_API_KEY ?? "",
    youtubeApiKey: source.YOUTUBE_API_KEY ?? "",
    aiModel: source.AI_MODEL ?? "glm-5.3-flash",
    maxAnalysisAttempts,
    port: Number(source.PORT ?? "8080"),
  };
}
