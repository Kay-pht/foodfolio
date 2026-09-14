import "dotenv/config";
import { buildApi } from "../api/build-api.js";
import { loadConfig } from "../config/env.js";
import { FirebaseAdminAuth } from "../infrastructure/auth/auth-verifier.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import {
  CloudTasksAnalysisQueue,
  LocalHttpAnalysisQueue,
} from "../infrastructure/tasks/task-queue.js";
import {
  ChatGptSharedConversationAdapter,
  GeminiSharedConversationAdapter,
  ProductionRecipeUrlCanonicalizer,
} from "../infrastructure/url/ai-shared-conversation.js";
import { AiAwareSourceContentExtractor } from "../infrastructure/url/ai-aware-source-content-extractor.js";
import { SafeHttpClient } from "../infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../infrastructure/url/source-content-extractor.js";

const config = loadConfig("api");
const auth = new FirebaseAdminAuth();
const taskQueue =
  config.analysisQueueDriver === "local-http"
    ? new LocalHttpAnalysisQueue({
        workerUrl: config.workerUrl,
        maxAttempts: config.maxAnalysisAttempts,
      })
    : new CloudTasksAnalysisQueue({
        projectId: config.gcpProjectId,
        location: config.cloudTasksLocation,
        queue: config.cloudTasksQueue,
        workerUrl: config.workerUrl,
        serviceAccountEmail: config.taskInvokerServiceAccount,
      });
const safeHttp = new SafeHttpClient();
const geminiShares = new GeminiSharedConversationAdapter();
const sourceExtractor = new AiAwareSourceContentExtractor(
  new ProductionSourceContentExtractor(
    safeHttp,
    config.youtubeApiKey,
    fetch,
    config.tiktokMediaAnalysisEnabled,
  ),
  new ChatGptSharedConversationAdapter(safeHttp),
  geminiShares,
);
const app = buildApi({
  prisma: getPrisma(),
  authVerifier: auth,
  firebaseUsers: auth,
  taskQueue,
  imageResolver: sourceExtractor,
  recipeUrlCanonicalizer: new ProductionRecipeUrlCanonicalizer(geminiShares),
});

await app.listen({ host: "0.0.0.0", port: config.port });
