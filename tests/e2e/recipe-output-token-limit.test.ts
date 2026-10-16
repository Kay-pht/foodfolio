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
import { YoutubeAwareRecipeExtractor } from "../../src/application/analysis/youtube-aware-recipe-extractor.js";
import { GeminiYoutubeRecipeExtractor } from "../../src/infrastructure/ai/gemini-youtube-recipe-extractor.js";
import { ZaiRecipeExtractor } from "../../src/infrastructure/ai/zai-recipe-extractor.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const extractedRecipe = {
  title: "卵焼き",
  servings: null,
  cookingTimeMinutes: null,
  genre: "主菜",
  ingredients: [{ name: "卵", amount: "2個" }],
  steps: ["卵を焼く"],
};

describe("Unified production recipe output limit through Worker, database and API", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { sourceType: "cookpad" as const, provider: "zai" },
    { sourceType: "youtube" as const, provider: "gemini" },
  ])(
    "sends 10000 tokens and persists $sourceType extraction using $provider",
    async ({ sourceType, provider }) => {
      const user = await context.prisma.user.create({
        data: {
          firebaseUid: `output-limit-${sourceType}`,
          setting: { create: {} },
        },
      });
      const url =
        sourceType === "youtube"
          ? "https://www.youtube.com/watch?v=0to72EbNg8A"
          : "https://cookpad.com/jp/recipes/12345678";
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: url,
          normalizedUrl: url,
          sourceType,
        },
      });
      const request = vi.fn<typeof fetch>(async () =>
        Response.json(
          provider === "zai"
            ? {
                choices: [
                  {
                    finish_reason: "stop",
                    message: { content: JSON.stringify(extractedRecipe) },
                  },
                ],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
              }
            : {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: {
                      parts: [
                        {
                          text: JSON.stringify({
                            ...extractedRecipe,
                            ingredients: [
                              {
                                name: "卵",
                                amountText: "2個",
                                evidenceText: "卵2個",
                                evidenceSource: "video_audio",
                              },
                            ],
                            procedureOnlyIngredients: [],
                          }),
                        },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                },
              },
        ),
      );
      vi.stubGlobal("fetch", request);
      const completed = vi.fn(async () => []);
      const failed = vi.fn(async () => []);
      const worker = buildWorker(
        new RecipeAnalysisService({
          prisma: context.prisma,
          sourceExtractor: {
            extract: async () => ({
              sourceType,
              resolvedUrl: url,
              imageUrl: null,
              textForAi: "卵焼き",
              youtubeTitle: "卵焼き",
              youtubeDescription: "動画をご覧ください",
            }),
          },
          recipeExtractor: new YoutubeAwareRecipeExtractor(
            new ZaiRecipeExtractor("test-key"),
            new GeminiYoutubeRecipeExtractor("test-key", request),
          ),
          notifications: {
            sendRecipeAnalysisCompleted: completed,
            sendRecipeAnalysisFailed: failed,
          },
          maxAttempts: 3,
        }),
      );
      const api = buildApi({
        prisma: context.prisma,
        authVerifier: {
          verifyIdToken: async () => ({ firebaseUid: user.firebaseUid }),
        },
        firebaseUsers: { deleteUser: async () => {} },
        taskQueue: { enqueueRecipeAnalysis: async () => {} },
      });
      try {
        const response = await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: recipe.id },
        });
        expect(response.statusCode).toBe(204);
        expect(request).toHaveBeenCalledOnce();
        const [endpoint, init] = request.mock.calls[0]!;
        const body = JSON.parse(String(init?.body));
        if (provider === "zai") {
          expect(endpoint).toBe(
            "https://api.z.ai/api/paas/v4/chat/completions",
          );
          expect(body.max_tokens).toBe(10000);
          expect(body).not.toHaveProperty("reasoning_effort");
        } else {
          expect(String(endpoint)).toContain(
            "generativelanguage.googleapis.com",
          );
          expect(body.generationConfig.maxOutputTokens).toBe(10000);
        }
        const saved = await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
        });
        expect(saved.analysisStatus).toBe("completed");
        expect(saved.analysisProvider).toBe(provider);
        const detail = await api.inject({
          method: "GET",
          url: `/v1/recipes/${recipe.id}`,
          headers: { authorization: "Bearer test-user" },
        });
        expect(detail.statusCode).toBe(200);
        expect(detail.json()).toMatchObject({
          title: "卵焼き",
          ingredients: [{ name: "卵", amount: "2個" }],
          steps: [{ text: "卵を焼く" }],
        });
        expect(failed).not.toHaveBeenCalled();
        await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: recipe.id },
        });
        expect(request).toHaveBeenCalledOnce();
      } finally {
        await worker.close();
        await api.close();
      }
    },
  );
});
