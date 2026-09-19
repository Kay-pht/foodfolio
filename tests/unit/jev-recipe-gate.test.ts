import { describe, expect, it } from "vitest";
import {
  classifyRecipeContent,
  JEV_INPUT_USD_PER_MILLION,
} from "../../poc/jev-recipe-gate/jev.js";
import {
  evaluateThresholds,
  type JevGateObservation,
} from "../../poc/jev-recipe-gate/metrics.js";

describe("Jev recipe gate threshold evaluation", () => {
  it("selects the lowest tested threshold with no recipe false rejects and at least one consistent non-recipe reject", () => {
    const observations: JevGateObservation[] = [
      {
        id: "recipe-a",
        expected: "recipe",
        repetition: 1,
        nonRecipeProbability: 0.2,
      },
      {
        id: "recipe-a",
        expected: "recipe",
        repetition: 2,
        nonRecipeProbability: 0.94,
      },
      {
        id: "recipe-b",
        expected: "recipe",
        repetition: 1,
        nonRecipeProbability: 0.1,
      },
      {
        id: "non-recipe-a",
        expected: "non-recipe",
        repetition: 1,
        nonRecipeProbability: 0.99,
      },
      {
        id: "non-recipe-a",
        expected: "non-recipe",
        repetition: 2,
        nonRecipeProbability: 0.97,
      },
      {
        id: "non-recipe-b",
        expected: "non-recipe",
        repetition: 1,
        nonRecipeProbability: 0.93,
      },
      {
        id: "non-recipe-b",
        expected: "non-recipe",
        repetition: 2,
        nonRecipeProbability: 0.91,
      },
    ];

    const result = evaluateThresholds(observations, [0.9, 0.95, 0.99]);

    expect(result.fixtureSafeCandidateThreshold).toBe(0.95);
    expect(result.metrics[0]?.recipeFalseRejectCaseIds).toEqual(["recipe-a"]);
    expect(result.metrics[1]?.recipeFalseRejectCaseIds).toEqual([]);
    expect(result.metrics[1]?.nonRecipeConsistentRejectCaseIds).toEqual([
      "non-recipe-a",
    ]);
  });

  it("treats one high-probability run as a recipe false-reject risk", () => {
    const result = evaluateThresholds(
      [
        {
          id: "recipe-unstable",
          expected: "recipe",
          repetition: 1,
          nonRecipeProbability: 0.02,
        },
        {
          id: "recipe-unstable",
          expected: "recipe",
          repetition: 2,
          nonRecipeProbability: 0.98,
        },
      ],
      [0.95],
    );

    expect(result.metrics[0]?.recipeFalseRejectCaseIds).toEqual([
      "recipe-unstable",
    ]);
    expect(result.fixtureSafeCandidateThreshold).toBeNull();
  });
});

describe("Jev recipe classifier", () => {
  it("uses the non-recipe option probability as the gate signal and records confidence separately", async () => {
    const calls: Array<{
      input: string | URL;
      init: RequestInit | undefined;
    }> = [];
    const fetchImpl = async (
      input: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            recipe_classification: {
              type: "choice",
              choice: "non_recipe",
              probabilities: { recipe: 0.03, non_recipe: 0.97 },
              confidence: 0.81,
            },
          },
          usage: { input_tokens: 1000, output_tokens: 20 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await classifyRecipeContent("page content", {
      apiKey: "test-key",
      fetchImpl,
    });

    expect(result.choice).toBe("non_recipe");
    expect(result.nonRecipeProbability).toBe(0.97);
    expect(result.confidence).toBe(0.81);
    expect(result.estimatedCostUsd).toBe(
      (1000 * JEV_INPUT_USD_PER_MILLION) / 1_000_000,
    );

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(calls[0]?.init?.headers).toEqual({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body.model).toBe("jev-1.13.0");
    expect(body.state).toEqual({ page_content: "page content" });
  });
});
