import "dotenv/config";
import { buildWorker } from "../api/build-worker.js";
import { RecipeAnalysisService } from "../application/analysis/analysis-service.js";
import { loadConfig } from "../config/env.js";
import { ZaiRecipeExtractor } from "../infrastructure/ai/zai-recipe-extractor.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import { FirebaseNotificationSender } from "../infrastructure/notifications/firebase-notification-sender.js";
import { SafeHttpClient } from "../infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../infrastructure/url/source-content-extractor.js";

const config = loadConfig("worker");
const service = new RecipeAnalysisService({
  prisma: getPrisma(),
  sourceExtractor: new ProductionSourceContentExtractor(
    new SafeHttpClient(),
    config.youtubeApiKey,
  ),
  recipeExtractor: new ZaiRecipeExtractor(config.zaiApiKey, config.aiModel),
  notifications: new FirebaseNotificationSender(),
  maxAttempts: config.maxAnalysisAttempts,
});
await buildWorker(service).listen({ host: "0.0.0.0", port: config.port });
