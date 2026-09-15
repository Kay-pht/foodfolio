import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  AnalysisError,
  type GeneratedRecipeImageStore,
  type RepresentativeImageResolver,
} from "../application/analysis/types.js";
import { InvalidRecipeUrlError } from "../domain/recipe/url.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type {
  AuthVerifier,
  FirebaseUserManager,
} from "../infrastructure/auth/auth-verifier.js";
import type { AnalysisTaskQueue } from "../infrastructure/tasks/task-queue.js";
import { AppError } from "./errors/app-error.js";
import { registerImageResolutionRoutes } from "./image-resolution-routes.js";
import { registerRoutes } from "./routes.js";
import { registerTagBatchRoutes } from "./tag-batch-routes.js";
import { registerWantToCookRoutes } from "./want-to-cook-routes.js";

export interface RecipeUrlCanonicalizer {
  canonicalize(input: string): Promise<string>;
}

export interface ApiDependencies {
  prisma: PrismaClient;
  authVerifier: AuthVerifier;
  firebaseUsers: FirebaseUserManager;
  taskQueue: AnalysisTaskQueue;
  imageResolver?: RepresentativeImageResolver;
  generatedImageStore?: GeneratedRecipeImageStore;
  recipeUrlCanonicalizer?: RecipeUrlCanonicalizer;
}

function bearerToken(request: FastifyRequest): string {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ") || value.length <= 7)
    throw new AppError(401, "UNAUTHENTICATED", "Authentication is required");
  return value.slice(7);
}

function sharedConversationAppError(error: AnalysisError): AppError | null {
  if (!error.code.startsWith("SHARED_CONVERSATION_")) return null;
  return new AppError(
    error.retryable ? 503 : 422,
    error.retryable ? "TEMPORARILY_UNAVAILABLE" : "VALIDATION_ERROR",
    error.message,
    { reason: error.code },
  );
}

export function buildApi(deps: ApiDependencies): FastifyInstance {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.body.token"] },
    requestIdHeader: "x-request-id",
  });
  app.decorateRequest("firebaseUid", "");
  app.decorateRequest("appUser");

  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      request.firebaseUid = (
        await deps.authVerifier.verifyIdToken(bearerToken(request))
      ).firebaseUid;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "UNAUTHENTICATED", "Authentication failed");
    }
  });
  app.decorate("resolveUser", async (request: FastifyRequest) => {
    request.appUser = await deps.prisma.user.upsert({
      where: { firebaseUid: request.firebaseUid },
      update: {},
      create: { firebaseUid: request.firebaseUid, setting: { create: {} } },
    });

    const body = request.body as { url?: unknown } | null;
    if (
      deps.recipeUrlCanonicalizer &&
      request.method === "POST" &&
      request.routeOptions.url === "/v1/recipes" &&
      typeof body?.url === "string"
    )
      body.url = await deps.recipeUrlCanonicalizer.canonicalize(body.url);
  });

  app.setErrorHandler((error, request, reply) => {
    const sharedError =
      error instanceof AnalysisError ? sharedConversationAppError(error) : null;
    const appError =
      error instanceof AppError
        ? error
        : error instanceof InvalidRecipeUrlError
          ? new AppError(400, "INVALID_URL", error.message)
          : (sharedError ??
            new AppError(500, "INTERNAL_ERROR", "Unexpected error"));
    if (
      !(error instanceof AppError) &&
      !(error instanceof InvalidRecipeUrlError) &&
      !sharedError
    )
      request.log.error({ err: error }, "unhandled request error");
    void reply.status(appError.statusCode).send({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId: request.id,
      },
    });
  });
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/health", async () => ({ status: "ok" }));
  registerRoutes(app, deps);
  registerImageResolutionRoutes(app, deps);
  registerTagBatchRoutes(app, deps);
  registerWantToCookRoutes(app, deps);
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
    resolveUser(request: FastifyRequest): Promise<void>;
  }
}
