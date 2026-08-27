import Fastify, { type FastifyInstance } from "fastify";
import { RecipeAnalysisService } from "../application/analysis/analysis-service.js";

export function buildWorker(service: RecipeAnalysisService): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: "x-request-id" });
  app.get("/healthz", async () => ({ status: "ok" }));
  app.post("/internal/tasks/recipe-analysis", async (request, reply) => {
    const body = request.body as { recipeId?: unknown } | null;
    if (typeof body?.recipeId !== "string")
      return reply.status(400).send({ error: "INVALID_REQUEST" });
    const retryCount = Number(
      request.headers["x-cloudtasks-taskretrycount"] ?? 0,
    );
    const attempt = Number.isFinite(retryCount) ? retryCount + 1 : 1;
    const result = await service.process(
      body.recipeId,
      attempt,
      (fields, message) => request.log.info(fields, message),
    );
    if (result.retry)
      return reply.status(503).send({ error: "RETRYABLE_ANALYSIS_ERROR" });
    return reply.status(204).send();
  });
  return app;
}
