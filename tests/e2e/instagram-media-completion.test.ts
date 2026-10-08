import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApi } from "../../src/api/build-api.js";
import { buildWorker } from "../../src/api/build-worker.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import { JevRecipeRouter } from "../../src/application/analysis/jev-routing.js";
import { ZaiRecipeExtractor } from "../../src/infrastructure/ai/zai-recipe-extractor.js";
import { ProductionInstagramMediaRecipeFallback } from "../../src/infrastructure/instagram/instagram-media-recipe-fallback.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

describe("Instagram media completion through Worker, database and API", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["timeout-success", ["timeout", "valid"]],
    ["schema-success", ["schema", "valid"]],
    ["third-attempt-success", ["timeout", "schema", "valid"]],
    ["timeout-exhausted", ["timeout", "timeout", "timeout"]],
    ["schema-exhausted", ["schema", "schema", "schema"]],
    ["permanent-rejection", ["rejected"]],
  ] as const)(
    "uses only task delivery retries for %s",
    async (name, outcomes) => {
      const user = await context.prisma.user.create({
        data: {
          firebaseUid: `retry-${name}`,
          setting: { create: {} },
          deviceTokens: { create: { fcmToken: `retry-token-${name}` } },
        },
      });
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: `https://www.instagram.com/p/${name}/`,
          normalizedUrl: `https://www.instagram.com/p/${name}/`,
          sourceType: "instagram",
        },
      });
      const provider = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          max_tokens: 10000,
          reasoning_effort: "low",
        });
        const outcome = outcomes[provider.mock.calls.length - 1];
        if (outcome === "timeout")
          throw new DOMException("timeout", "TimeoutError");
        if (outcome === "rejected") return new Response("{}", { status: 400 });
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify(
                    outcome === "schema"
                      ? { title: 42 }
                      : {
                          title: "一部の材料を省いたレシピ",
                          servings: null,
                          cookingTimeMinutes: null,
                          genre: null,
                          ingredients: [{ name: "にんじん", amount: null }],
                          steps: ["混ぜる"],
                        },
                  ),
                },
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 100 },
          }),
        );
      });
      vi.stubGlobal("fetch", provider);
      const dispose = vi.fn(async () => {});
      const completed = vi.fn(async () => []);
      const failed = vi.fn(async () => []);
      const finishAdmission = vi.fn(async () => {});
      const text = vi.fn();
      const media = new ProductionInstagramMediaRecipeFallback(
        {
          retrieve: async () => ({
            attempts: 1,
            items: [
              {
                index: 1,
                kind: "image",
                url: "https://storage.example/retry.jpg",
                contentType: "image/jpeg",
                dispose: async () => {},
              },
            ],
            dispose,
          }),
        },
        new ZaiRecipeExtractor("local-key"),
      );
      const worker = buildWorker(
        new RecipeAnalysisService({
          prisma: context.prisma,
          sourceExtractor: {
            extract: async () => ({
              sourceType: "instagram",
              resolvedUrl: recipe.originalUrl,
              imageUrl: null,
              textForAi: null,
            }),
          },
          recipeExtractor: { extract: text },
          instagramMediaFallback: media,
          notifications: {
            sendRecipeAnalysisCompleted: completed,
            sendRecipeAnalysisFailed: failed,
            sendRecipeAnalysisNotRecipe: async () => [],
          },
          maxAttempts: 3,
        }),
        finishAdmission,
      );
      try {
        for (let i = 0; i < outcomes.length; i++) {
          const final = i === outcomes.length - 1;
          const response = await worker.inject({
            method: "POST",
            url: "/internal/tasks/recipe-analysis",
            headers: { "x-cloudtasks-taskretrycount": String(i) },
            payload: { recipeId: recipe.id },
          });
          expect(response.statusCode).toBe(final ? 204 : 503);
          expect(provider).toHaveBeenCalledTimes(i + 1);
          const saved = await context.prisma.recipe.findUniqueOrThrow({
            where: { id: recipe.id },
            include: { ingredients: true, steps: true },
          });
          expect(saved.analysisStatus).toBe(
            !final
              ? "pending"
              : outcomes[i] === "valid"
                ? "completed"
                : "failed",
          );
          expect(saved.processingRunId).toBeNull();
          expect(saved.processingLeaseExpiresAt).toBeNull();
          if (!final) {
            expect(saved.ingredients).toHaveLength(0);
            expect(saved.steps).toHaveLength(0);
            expect(failed).not.toHaveBeenCalled();
            expect(completed).not.toHaveBeenCalled();
            expect(finishAdmission).not.toHaveBeenCalled();
          }
        }
        const success = outcomes[outcomes.length - 1] === "valid";
        expect(completed).toHaveBeenCalledTimes(success ? 1 : 0);
        expect(failed).toHaveBeenCalledTimes(success ? 0 : 1);
        expect(finishAdmission).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledTimes(outcomes.length);
        expect(text).not.toHaveBeenCalled();
        await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: recipe.id },
        });
        expect(provider).toHaveBeenCalledTimes(outcomes.length);
        expect(completed).toHaveBeenCalledTimes(success ? 1 : 0);
        expect(failed).toHaveBeenCalledTimes(success ? 0 : 1);
      } finally {
        await worker.close();
      }
    },
    120_000,
  );

  it.each([true, false])(
    "finishes caption text without media only when complete=%s",
    async (complete) => {
      const user = await context.prisma.user.create({
        data: { firebaseUid: `caption-${complete}` },
      });
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: `https://www.instagram.com/p/caption-${complete}/`,
          normalizedUrl: `https://www.instagram.com/p/caption-${complete}/`,
          sourceType: "instagram",
        },
      });
      const provider = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const media = Array.isArray(body.messages[1].content);
        expect(body.max_tokens).toBe(10000);
        expect(body.reasoning_effort).toBe("low");
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    title: "にんじんサラダ",
                    servings: null,
                    cookingTimeMinutes: null,
                    genre: null,
                    ingredients: [{ name: "にんじん", amount: "2本" }],
                    steps: complete || media ? ["混ぜる"] : [],
                  }),
                },
              },
            ],
          }),
        );
      });
      vi.stubGlobal("fetch", provider);
      const retrieve = vi.fn(async () => ({
        attempts: 1,
        items: [
          {
            index: 1,
            kind: "image" as const,
            url: "https://storage.example/caption.jpg",
            contentType: "image/jpeg",
            dispose: async () => {},
          },
        ],
        dispose: async () => {},
      }));
      const extractor = new ZaiRecipeExtractor("local-key");
      const classifier = vi.fn(async () => ({
        model: "jev-1.13.0",
        choice: "recipe" as const,
        recipeProbability: 1,
        nonRecipeProbability: 0,
        latencyMs: 1,
      }));
      const worker = buildWorker(
        new RecipeAnalysisService({
          prisma: context.prisma,
          sourceExtractor: {
            extract: async () => ({
              sourceType: "instagram",
              resolvedUrl: recipe.originalUrl,
              imageUrl: null,
              textForAi: "材料 にんじん2本。作り方 混ぜる",
            }),
          },
          recipeExtractor: extractor,
          textRecipeExtractor: extractor,
          instagramMediaFallback: new ProductionInstagramMediaRecipeFallback(
            { retrieve },
            extractor,
          ),
          jevRouter: new JevRecipeRouter(
            { model: "jev-1.13.0", classify: classifier },
            {
              generalWebNonRecipe: 0.8,
              youtubeRecipe: 0.99,
              instagramRecipe: 0.99,
              tiktokVideoRecipe: 0.99,
              tiktokPhotoRecipe: 0.99,
              aiChatNonRecipe: 0.99,
            },
          ),
          notifications: {
            sendRecipeAnalysisCompleted: async () => [],
            sendRecipeAnalysisFailed: async () => [],
            sendRecipeAnalysisNotRecipe: async () => [],
          },
          maxAttempts: 3,
        }),
      );
      try {
        expect(
          (
            await worker.inject({
              method: "POST",
              url: "/internal/tasks/recipe-analysis",
              payload: { recipeId: recipe.id },
            })
          ).statusCode,
        ).toBe(204);
        expect(
          (
            await context.prisma.recipe.findUniqueOrThrow({
              where: { id: recipe.id },
            })
          ).analysisStatus,
        ).toBe("completed");
        expect(classifier).toHaveBeenCalledOnce();
        expect(provider).toHaveBeenCalledTimes(complete ? 1 : 2);
        expect(retrieve).toHaveBeenCalledTimes(complete ? 0 : 1);
      } finally {
        await worker.close();
      }
    },
    120_000,
  );

  it.each(["partial-recipe", "truncated", "empty-recipe"] as const)(
    "preserves completion and failure behavior for %s",
    async (kind) => {
      const firebaseUid = `instagram-completion-${kind}`;
      const user = await context.prisma.user.create({
        data: {
          firebaseUid,
          setting: { create: {} },
          deviceTokens: { create: { fcmToken: `local-test-token-${kind}` } },
        },
      });
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: "https://www.instagram.com/p/local-completion/",
          normalizedUrl: "https://www.instagram.com/p/local-completion/",
          sourceType: "instagram",
        },
      });
      const output = {
        title: "にんじんサラダ",
        servings: null,
        cookingTimeMinutes: null,
        genre: "サラダ",
        ingredients:
          kind === "empty-recipe" ? [] : [{ name: "にんじん", amount: "2本" }],
        steps: kind === "empty-recipe" ? [] : ["混ぜる"],
      };
      const provider = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          max_tokens: 10000,
          reasoning_effort: "low",
        });
        return new Response(
          JSON.stringify({
            id: "local-provider-response",
            choices: [
              {
                finish_reason: kind === "truncated" ? "length" : "stop",
                message: {
                  content: kind === "truncated" ? "" : JSON.stringify(output),
                },
              },
            ],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: kind === "truncated" ? 10000 : 300,
            },
          }),
        );
      });
      vi.stubGlobal("fetch", provider);
      const dispose = vi.fn(async () => {});
      const retriever = vi.fn(async () => ({
        attempts: 1,
        items: [
          {
            index: 1,
            kind: "image" as const,
            url: "https://storage.example/local.jpg",
            contentType: "image/jpeg",
            dispose: async () => {},
          },
        ],
        dispose,
      }));
      const completed = vi.fn(async () => []);
      const failed = vi.fn(async () => []);
      const logs: Record<string, unknown>[] = [];
      const media = new ProductionInstagramMediaRecipeFallback(
        { retrieve: retriever },
        new ZaiRecipeExtractor("local-test-key"),
      );
      const service = new RecipeAnalysisService({
        prisma: context.prisma,
        sourceExtractor: {
          extract: async () => ({
            sourceType: "instagram",
            resolvedUrl: recipe.originalUrl,
            imageUrl: null,
            textForAi: "材料 にんじん2本、にんにく。作り方 混ぜる",
          }),
        },
        recipeExtractor: {
          extract: async () => ({
            recipe: { ...output, ingredients: [], steps: [] },
            provider: "zai",
            providerRequestId: "local-text",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
          }),
        },
        instagramMediaFallback: media,
        notifications: {
          sendRecipeAnalysisCompleted: completed,
          sendRecipeAnalysisFailed: failed,
          sendRecipeAnalysisNotRecipe: async () => [],
        },
        maxAttempts: 3,
      });
      const worker = buildWorker({
        process: (id, attempt, log) =>
          service.process(id, attempt, (fields, message) => {
            logs.push({ ...fields, message });
            log?.(fields, message);
          }),
      });
      const api = buildApi({
        prisma: context.prisma,
        authVerifier: { verifyIdToken: async () => ({ firebaseUid }) },
        firebaseUsers: { deleteUser: async () => {} },
        taskQueue: { enqueueRecipeAnalysis: async () => {} },
      });
      try {
        const response = await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          headers: { "x-cloudtasks-taskretrycount": "2" },
          payload: { recipeId: recipe.id },
        });
        expect(response.statusCode).toBe(204);
        const saved = await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
          include: { ingredients: true, steps: true },
        });
        expect(provider).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
        if (kind === "partial-recipe") {
          expect(saved.analysisStatus).toBe("completed");
          expect(saved.ingredients.map((i) => i.name)).toEqual(["にんじん"]);
          expect(saved.steps.map((s) => s.text)).toEqual(["混ぜる"]);
          const headers = { authorization: "Bearer local-test" };
          const read = await api.inject({
            method: "GET",
            url: `/v1/recipes/${recipe.id}`,
            headers,
          });
          expect(read.statusCode).toBe(200);
          expect(read.json()).toMatchObject({
            analysisStatus: "completed",
            title: output.title,
          });
          expect(read.json().ingredients).toHaveLength(1);
          const sync = await api.inject({
            method: "GET",
            url: "/v1/sync",
            headers,
          });
          expect(sync.statusCode).toBe(200);
          expect(
            sync.json().recipes.find((r: { id: string }) => r.id === recipe.id)
              .analysisStatus,
          ).toBe("completed");
          expect(completed).toHaveBeenCalledOnce();
          expect(failed).not.toHaveBeenCalled();
          expect(
            (
              await worker.inject({
                method: "POST",
                url: "/internal/tasks/recipe-analysis",
                payload: { recipeId: recipe.id },
              })
            ).statusCode,
          ).toBe(204);
          expect(provider).toHaveBeenCalledOnce();
          expect(completed).toHaveBeenCalledOnce();
          expect(
            await context.prisma.ingredient.count({
              where: { recipeId: recipe.id },
            }),
          ).toBe(1);
        } else {
          expect(saved.analysisStatus).toBe("failed");
          expect(saved.ingredients).toHaveLength(0);
          expect(saved.steps).toHaveLength(0);
          expect(completed).not.toHaveBeenCalled();
          expect(failed).toHaveBeenCalledOnce();
          expect(logs.find((l) => l.analysisStatus === "failed")).toMatchObject(
            {
              errorCode:
                kind === "truncated"
                  ? "AI_INVALID_JSON"
                  : "SOURCE_CONTENT_UNAVAILABLE",
            },
          );
          if (kind === "truncated")
            expect(
              logs.find((l) => l.analysisStatus === "failed")?.summary,
            ).toEqual(expect.stringContaining("10000"));
        }
      } finally {
        await api.close();
        await worker.close();
      }
    },
    120_000,
  );
});
