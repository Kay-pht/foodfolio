import "dotenv/config";
import { buildWorker } from "../api/build-worker.js";
import { RecipeAnalysisService } from "../application/analysis/analysis-service.js";
import { YoutubeAwareRecipeExtractor } from "../application/analysis/youtube-aware-recipe-extractor.js";
import { loadConfig } from "../config/env.js";
import { ZaiRecipeExtractor } from "../infrastructure/ai/zai-recipe-extractor.js";
import { GeminiYoutubeRecipeExtractor } from "../infrastructure/ai/gemini-youtube-recipe-extractor.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import { FirebaseNotificationSender } from "../infrastructure/notifications/firebase-notification-sender.js";
import { NoopNotificationSender } from "../infrastructure/notifications/noop-notification-sender.js";
import { GcsTemporaryVideoStore } from "../infrastructure/tiktok/gcs-temporary-video-store.js";
import { ProductionTikTokVideoRecipeFallback } from "../infrastructure/tiktok/tiktok-video-recipe-fallback.js";
import { YtDlpTikTokVideoDownloader } from "../infrastructure/tiktok/yt-dlp-video-downloader.js";
import { SafeHttpClient } from "../infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../infrastructure/url/source-content-extractor.js";

const config = loadConfig("worker");
const recipeExtractor = new ZaiRecipeExtractor(
  config.zaiApiKey,
  config.aiModel,
);
const routedRecipeExtractor = new YoutubeAwareRecipeExtractor(
  recipeExtractor,
  config.youtubeGeminiFallbackEnabled
    ? new GeminiYoutubeRecipeExtractor(config.geminiApiKey)
    : null,
);
const tiktokVideoFallback = config.tiktokVideoFallbackEnabled
  ? new ProductionTikTokVideoRecipeFallback(
      new YtDlpTikTokVideoDownloader({
        binaryPath: config.ytDlpPath,
        maxAttempts: config.tiktokVideoMaxAttempts,
        attemptTimeoutMs: 45_000,
        retryBaseSeconds: 2,
        maxRetrySeconds: 10,
      }),
      new GcsTemporaryVideoStore(config.tiktokVideoBucket),
      recipeExtractor,
    )
  : null;
const notifications =
  config.notificationDriver === "noop"
    ? new NoopNotificationSender()
    : new FirebaseNotificationSender();
const service = new RecipeAnalysisService({
  prisma: getPrisma(),
  sourceExtractor: new ProductionSourceContentExtractor(
    new SafeHttpClient(),
    config.youtubeApiKey,
  ),
  recipeExtractor: routedRecipeExtractor,
  ...(tiktokVideoFallback ? { tiktokVideoFallback } : {}),
  notifications,
  maxAttempts: config.maxAnalysisAttempts,
});
await buildWorker(service).listen({ host: "0.0.0.0", port: config.port });
