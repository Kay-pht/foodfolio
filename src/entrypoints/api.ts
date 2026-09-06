import "dotenv/config";
import { buildApi } from "../api/build-api.js";
import { loadConfig } from "../config/env.js";
import { FirebaseAdminAuth } from "../infrastructure/auth/auth-verifier.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import {
  CloudTasksAnalysisQueue,
  LocalHttpAnalysisQueue,
} from "../infrastructure/tasks/task-queue.js";

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
const app = buildApi({
  prisma: getPrisma(),
  authVerifier: auth,
  firebaseUsers: auth,
  taskQueue,
});

await app.listen({ host: "0.0.0.0", port: config.port });
