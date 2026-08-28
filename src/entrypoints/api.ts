import "dotenv/config";
import { buildApi } from "../api/build-api.js";
import { loadConfig } from "../config/env.js";
import { FirebaseAdminAuth } from "../infrastructure/auth/auth-verifier.js";
import { getPrisma } from "../infrastructure/db/prisma.js";
import { CloudTasksAnalysisQueue } from "../infrastructure/tasks/task-queue.js";

const config = loadConfig("api");
const auth = new FirebaseAdminAuth();
const app = buildApi({
  prisma: getPrisma(),
  authVerifier: auth,
  firebaseUsers: auth,
  taskQueue: new CloudTasksAnalysisQueue({
    projectId: config.gcpProjectId,
    location: config.cloudTasksLocation,
    queue: config.cloudTasksQueue,
    workerUrl: config.workerUrl,
    serviceAccountEmail: config.taskInvokerServiceAccount,
  }),
});

await app.listen({ host: "0.0.0.0", port: config.port });
