import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { buildWorker } from "../../src/api/build-worker.js";
import { RecipeAnalysisService } from "../../src/application/analysis/analysis-service.js";
import { extractYoutubeForPoc } from "../../poc/ai-extraction/gemini-youtube-adapter.js";
import {
  startPostgres,
  stopPostgres,
  type PostgresTestContext,
} from "../helpers/postgres.js";

const empty = {
  title: null,
  servings: null,
  cookingTimeMinutes: null,
  genre: null,
  ingredients: [],
  steps: [],
};
const valid = {
  ...empty,
  title: "卵料理",
  ingredients: [{ name: "卵", amount: "2個" }],
  steps: ["卵を焼く"],
};
const candidate = (recipe: unknown, finishReason = "STOP") => ({
  candidates: [
    { finishReason, content: { parts: [{ text: JSON.stringify(recipe) }] } },
  ],
});
const scenarios = [
  {
    name: "malformed envelope",
    body: { candidates: [{ content: { parts: { text: "bad" } } }] },
    http: 200,
  },
  {
    name: "quota 429",
    body: { error: { status: "RESOURCE_EXHAUSTED" } },
    http: 429,
  },
  {
    name: "unavailable video 400",
    body: { error: { status: "INVALID_ARGUMENT" } },
    http: 400,
  },
  {
    name: "not found 404",
    body: { error: { status: "NOT_FOUND" } },
    http: 404,
  },
  {
    name: "upstream 503",
    body: { error: { status: "UNAVAILABLE" } },
    http: 503,
  },
  { name: "empty recipe", body: candidate(empty), http: 200 },
  { name: "schema mismatch", body: candidate({ title: "料理" }), http: 200 },
  {
    name: "invalid JSON",
    body: {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } },
      ],
    },
    http: 200,
  },
  {
    name: "truncated valid JSON",
    body: candidate(valid, "MAX_TOKENS"),
    http: 200,
  },
  {
    name: "safety blocked",
    body: { promptFeedback: { blockReason: "SAFETY" } },
    http: 200,
  },
  { name: "timeout", body: {}, http: 200 },
  { name: "success", body: candidate(valid), http: 200 },
];

describe("Gemini PoC adapter → real Worker → PostgreSQL (mock Gemini)", () => {
  let context: PostgresTestContext;
  beforeAll(async () => {
    context = await startPostgres();
  }, 120_000);
  afterAll(async () => {
    await stopPostgres(context);
  }, 120_000);
  it.each(scenarios)(
    "$name persists the correct state without retry",
    async (scenario) => {
      const user = await context.prisma.user.create({
        data: {
          firebaseUid: randomUUID(),
          setting: { create: {} },
          deviceTokens: { create: { fcmToken: randomUUID() } },
        },
      });
      const url = "https://www.youtube.com/watch?v=0to72EbNg8A";
      const recipe = await context.prisma.recipe.create({
        data: {
          userId: user.id,
          originalUrl: url,
          normalizedUrl: url,
          sourceType: "youtube",
        },
      });
      const request = vi.fn<typeof fetch>();
      if (scenario.name === "timeout")
        request.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
      else
        request.mockImplementation(async () =>
          Response.json(scenario.body, { status: scenario.http }),
        );
      const completed = vi.fn(async () => [] as string[]);
      const failed = vi.fn(async () => [] as string[]);
      const worker = buildWorker(
        new RecipeAnalysisService({
          prisma: context.prisma,
          maxAttempts: 3,
          sourceExtractor: {
            extract: async () => ({
              sourceType: "youtube",
              resolvedUrl: url,
              imageUrl: null,
              textForAi: "卵2個",
            }),
          },
          recipeExtractor: {
            extract: async (source) =>
              extractYoutubeForPoc(
                source.resolvedUrl,
                source.textForAi!,
                "fake-key",
                request,
              ),
          },
          notifications: {
            sendRecipeAnalysisCompleted: completed,
            sendRecipeAnalysisFailed: failed,
          },
        }),
      );
      try {
        const response = await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: recipe.id },
        });
        expect(response.statusCode).toBe(204);
        const saved = await context.prisma.recipe.findUniqueOrThrow({
          where: { id: recipe.id },
          include: { ingredients: true, steps: true },
        });
        const success = scenario.name === "success";
        expect(saved.analysisStatus).toBe(success ? "completed" : "failed");
        expect(saved.title).toBe(success ? "卵料理" : "解析に失敗したレシピ");
        expect(saved.ingredients).toHaveLength(success ? 1 : 0);
        expect(saved.steps).toHaveLength(success ? 1 : 0);
        expect(completed).toHaveBeenCalledTimes(success ? 1 : 0);
        expect(failed).toHaveBeenCalledTimes(success ? 0 : 1);
        await worker.inject({
          method: "POST",
          url: "/internal/tasks/recipe-analysis",
          payload: { recipeId: recipe.id },
        });
        expect(request).toHaveBeenCalledTimes(1);
      } finally {
        await worker.close();
      }
    },
  );
});
