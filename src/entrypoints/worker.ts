import "dotenv/config";
import { buildWorker } from "../api/build-worker.js";
import { finishAnalysisAdmission } from "../application/analysis/admission-service.js";
import { RecipeAnalysisService } from "../application/analysis/analysis-service.js";
import { YoutubeAwareRecipeExtractor } from "../application/analysis/youtube-aware-recipe-extractor.js";
import { loadConfig } from "../config/env.js";
import { GeminiYoutubeRecipeExtractor } from "../infrastructure/ai/gemini-youtube-recipe-extractor.js";
import { OpenAiRecipeThumbnailGenerator } from "../infrastructure/ai/openai-recipe-thumbnail-generator.js";
import { ZaiRecipeExtractor } from "../infrastructure/ai/zai-recipe-extractor.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import { ProductionInstagramMediaRecipeFallback } from "../infrastructure/instagram/instagram-media-recipe-fallback.js";
import { YtDlpInstagramMediaRetriever } from "../infrastructure/instagram/yt-dlp-instagram-media-retriever.js";
import { GcsGeneratedRecipeImageStore } from "../infrastructure/media/gcs-generated-recipe-image-store.js";
import { GcsTemporaryMediaStore } from "../infrastructure/media/gcs-temporary-media-store.js";
import { FirebaseNotificationSender } from "../infrastructure/notifications/firebase-notification-sender.js";
import { NoopNotificationSender } from "../infrastructure/notifications/noop-notification-sender.js";
import { GcsTemporaryVideoStore } from "../infrastructure/tiktok/gcs-temporary-video-store.js";
import { ProductionTikTokPhotoRecipeAnalysis } from "../infrastructure/tiktok/tiktok-photo-recipe-analysis.js";
import { ProductionTikTokVideoRecipeFallback } from "../infrastructure/tiktok/tiktok-video-recipe-fallback.js";
import { YtDlpTikTokVideoDownloader } from "../infrastructure/tiktok/yt-dlp-video-downloader.js";
import {
  ChatGptSharedConversationAdapter,
  GeminiSharedConversationAdapter,
} from "../infrastructure/url/ai-shared-conversation.js";
import { AiAwareSourceContentExtractor } from "../infrastructure/url/ai-aware-source-content-extractor.js";
import { SafeHttpClient } from "../infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../infrastructure/url/source-content-extractor.js";

const config = loadConfig("worker");
const prisma = getPrisma();
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
const tiktokMediaStore = config.tiktokMediaAnalysisEnabled
  ? new GcsTemporaryMediaStore({
      bucketName: config.tiktokVideoBucket,
      publishFailure: {
        code: "TIKTOK_PHOTO_PUBLISH_FAILED",
        retryable: true,
        message: "Temporary TikTok photo publishing failed",
      },
    })
  : null;
const tiktokPhotoAnalysis = tiktokMediaStore
  ? new ProductionTikTokPhotoRecipeAnalysis(tiktokMediaStore, recipeExtractor)
  : null;
const tiktokVideoFallback = config.tiktokMediaAnalysisEnabled
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
const instagramMediaFallback = config.instagramMediaFallbackEnabled
  ? new ProductionInstagramMediaRecipeFallback(
      new YtDlpInstagramMediaRetriever(
        {
          binaryPath: config.ytDlpPath,
          maxAttempts: config.instagramMediaMaxAttempts,
          attemptTimeoutMs: 45_000,
          retryBaseSeconds: 2,
          maxRetrySeconds: 10,
        },
        new GcsTemporaryMediaStore({
          bucketName: config.instagramMediaBucket,
          signedUrlLifetimeMs: 30 * 60 * 1000,
          publishFailure: {
            code: "INSTAGRAM_MEDIA_PUBLISH_FAILED",
            retryable: true,
            message: "Temporary Instagram media publishing failed",
          },
        }),
      ),
      recipeExtractor,
    )
  : null;
const generatedImageStore = config.generatedRecipeImageBucket
  ? new GcsGeneratedRecipeImageStore(config.generatedRecipeImageBucket)
  : null;
const recipeThumbnailGenerator =
  config.openAiApiKey && generatedImageStore
    ? new OpenAiRecipeThumbnailGenerator(
        config.openAiApiKey,
        config.openAiImageModel,
      )
    : null;
const notifications =
  config.notificationDriver === "noop"
    ? new NoopNotificationSender()
    : new FirebaseNotificationSender();
const safeHttp = new SafeHttpClient();
const sourceExtractor = new AiAwareSourceContentExtractor(
  new ProductionSourceContentExtractor(
    safeHttp,
    config.youtubeApiKey,
    fetch,
    config.tiktokMediaAnalysisEnabled,
  ),
  new ChatGptSharedConversationAdapter(safeHttp),
  new GeminiSharedConversationAdapter(),
);
const service = new RecipeAnalysisService({
  prisma,
  sourceExtractor,
  recipeExtractor: routedRecipeExtractor,
  ...(tiktokVideoFallback ? { tiktokVideoFallback } : {}),
  ...(tiktokPhotoAnalysis ? { tiktokPhotoAnalysis } : {}),
  ...(instagramMediaFallback ? { instagramMediaFallback } : {}),
  ...(recipeThumbnailGenerator && generatedImageStore
    ? { recipeThumbnailGenerator, generatedImageStore }
    : {}),
  notifications,
  maxAttempts: config.maxAnalysisAttempts,
});
await buildWorker(service, (recipeId) =>
  finishAnalysisAdmission(prisma, recipeId),
).listen({ host: "0.0.0.0", port: config.port });
