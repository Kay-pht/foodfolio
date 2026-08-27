import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPipeline } from "../../poc/end-to-end/pipeline.js";
import type {
  ExpectedFixture,
  ProviderResponse,
} from "../../poc/ai-extraction/types.js";

let server: Server | null = null;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
  server = null;
});

describe("recipe URL to schema E2E", () => {
  it("extracts a live HTTP page, sends identical text, and validates AI JSON", async () => {
    const recipe = {
      title: "親子丼",
      servings: { value: 2, raw: "2人分" },
      cookingTimeMinutes: 20,
      genre: "主食" as const,
      ingredients: [{ name: "鶏肉", amount: "200g" }],
      steps: ["鶏肉を煮る"],
    };
    server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head>
        <script type="application/ld+json">${JSON.stringify({
          "@type": "Recipe",
          name: "親子丼",
          recipeYield: "2人分",
          totalTime: "PT20M",
          recipeIngredient: ["鶏肉 200g"],
          recipeInstructions: ["鶏肉を煮る"],
        })}</script></head><body>材料 作り方 親子丼</body></html>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const fixture: ExpectedFixture = {
      id: "local-recipe",
      sourceUrl: `http://127.0.0.1:${address.port}/recipe`,
      recipe,
    };
    let receivedText = "";
    const result = await runPipeline(
      {
        id: fixture.id,
        source: "general-web",
        url: fixture.sourceUrl,
        kind: "recipe",
      },
      fixture,
      "openai",
      async (_provider, sourceText): Promise<ProviderResponse> => {
        receivedText = sourceText;
        return {
          provider: "openai",
          model: "deterministic-test-model",
          outputText: JSON.stringify(recipe),
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cachedInputTokens: 0,
          },
          elapsedMs: 1,
          requestId: "test-request",
          rawResponse: {},
        };
      },
    );
    expect(receivedText).toContain("STRUCTURED_RECIPE_DATA");
    expect(result.evaluation.schemaSuccess).toBe(true);
    expect(result.evaluation.hallucinationCount).toBe(0);
  });
});
