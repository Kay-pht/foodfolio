import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGET_PER_KIND,
  evaluateCorpusQuality,
  zeroFailureUpperBound95,
} from "../../poc/jev-recipe-gate/corpus-policy.js";
import {
  DEFAULT_TARGET_PER_KIND,
  evaluateCorpusQuality,
  MIN_HARD_NEGATIVE_COUNT,
  siteCapForTarget,
  zeroFailureUpperBound95,
} from "../../poc/jev-recipe-gate/corpus-policy.js";
import {
  classifyKnownUrl,
  isKnownRecipeUrl,
} from "../../poc/jev-recipe-gate/discovery.js";
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


describe("Jev recipe gate corpus policy", () => {
  it("uses 300 recipe URLs as the default content-diversity floor", () => {
    expect(DEFAULT_TARGET_PER_KIND).toBe(300);
    expect(zeroFailureUpperBound95(300)).toBeLessThan(0.01);
    expect(zeroFailureUpperBound95(18)).toBeGreaterThan(0.15);
  });

  it("requires 300/300 cases, 200 hard negatives, and cross-site diversity", () => {
    const recipe = Array.from({ length: 300 }, (_, index) => ({
      kind: "recipe" as const,
      discoverySite: `recipe-site-${index % 3}`,
      negativeTier: null,
    }));
    const nonRecipe = Array.from({ length: 300 }, (_, index) => ({
      kind: "non-recipe" as const,
      discoverySite: `negative-site-${index % 3}`,
      negativeTier: index < 200 ? ("hard" as const) : ("easy" as const),
    }));

    const quality = evaluateCorpusQuality([...recipe, ...nonRecipe]);

    expect(quality.recipeCount).toBe(300);
    expect(quality.nonRecipeCount).toBe(300);
    expect(quality.hardNegativeCount).toBe(200);
    expect(quality.recipeSiteCount).toBe(3);
    expect(quality.nonRecipeSiteCount).toBe(3);
    expect(quality.maxRecipeSiteShare).toBeLessThanOrEqual(0.4);
    expect(quality.maxNonRecipeSiteShare).toBeLessThanOrEqual(0.4);
    expect(quality.meetsDefaultTarget).toBe(true);
  });

  it("rejects a corpus dominated by one site even when raw counts are large", () => {
    const recipe = Array.from({ length: 300 }, () => ({
      kind: "recipe" as const,
      discoverySite: "one-site",
      negativeTier: null,
    }));
    const nonRecipe = Array.from({ length: 300 }, (_, index) => ({
      kind: "non-recipe" as const,
      discoverySite: `negative-site-${index % 3}`,
      negativeTier: "hard" as const,
    }));

    expect(
      evaluateCorpusQuality([...recipe, ...nonRecipe]).meetsDefaultTarget,
    ).toBe(false);
  });
});


describe("Jev recipe gate corpus policy", () => {
  it("requires 500 recipe and 500 non-recipe URLs by default", () => {
    expect(DEFAULT_TARGET_PER_KIND).toBe(500);
    expect(MIN_HARD_NEGATIVE_COUNT).toBe(350);
    expect(siteCapForTarget(DEFAULT_TARGET_PER_KIND)).toBe(200);
  });

  it("puts the zero-false-reject one-sided 95% upper bound below 0.6% at 500 recipe cases", () => {
    expect(zeroFailureUpperBound95(500)).toBeLessThan(0.006);
    expect(zeroFailureUpperBound95(500)).toBeGreaterThan(0.005);
  });

  it("rejects a corpus that is large enough but dominated by one site", () => {
    const cases = [
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "recipe" as const,
        discoverySite: index < 300 ? "site-a" : index < 400 ? "site-b" : "site-c",
        negativeTier: null,
      })),
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "non-recipe" as const,
        discoverySite: index < 300 ? "site-a" : index < 400 ? "site-b" : "site-c",
        negativeTier: index < 350 ? ("hard" as const) : ("easy" as const),
      })),
    ];

    const quality = evaluateCorpusQuality(cases);

    expect(quality.recipeCount).toBe(500);
    expect(quality.nonRecipeCount).toBe(500);
    expect(quality.meetsDefaultTarget).toBe(false);
    expect(quality.maxRecipeSiteShare).toBe(0.6);
    expect(quality.maxNonRecipeSiteShare).toBe(0.6);
  });

  it("accepts a balanced 1000 URL corpus with enough hard negatives", () => {
    const sites = ["site-a", "site-b", "site-c", "site-d", "site-e"];
    const cases = [
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "recipe" as const,
        discoverySite: sites[index % sites.length] ?? "site-a",
        negativeTier: null,
      })),
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "non-recipe" as const,
        discoverySite: sites[index % sites.length] ?? "site-a",
        negativeTier: index < 350 ? ("hard" as const) : ("easy" as const),
      })),
    ];

    const quality = evaluateCorpusQuality(cases);

    expect(quality.meetsDefaultTarget).toBe(true);
    expect(quality.hardNegativeCount).toBe(350);
    expect(quality.recipeSiteCount).toBe(5);
    expect(quality.nonRecipeSiteCount).toBe(5);
  });

  it("recognizes the explicit recipe URL patterns used for discovery", () => {
    expect(
      isKnownRecipeUrl(
        "https://delishkitchen.tv/recipes/378791542590013783",
      ),
    ).toBe(true);
    expect(
      isKnownRecipeUrl(
        "https://oceans-nadia.com/user/11285/recipe/393839",
      ),
    ).toBe(true);
    expect(
      isKnownRecipeUrl(
        "https://www.kyounoryouri.jp/recipe/20758_%E3%83%9B%E3%82%A8%E3%83%BC%E3%81%AE%E3%81%A4%E3%81%8F%E3%82%8A%E6%96%B9.html",
      ),
    ).toBe(true);
    expect(isKnownRecipeUrl("https://delishkitchen.tv/categories/17387")).toBe(
      false,
    );
  });

  it("labels only explicit non-recipe route families as negatives", () => {
    expect(
      classifyKnownUrl("https://delishkitchen.tv/categories/17387"),
    ).toMatchObject({
      kind: "non-recipe",
      discoverySite: "delish-kitchen",
      negativeTier: "hard",
    });
    expect(
      classifyKnownUrl("https://www.kyounoryouri.jp/recipe"),
    ).toMatchObject({
      kind: "non-recipe",
      discoverySite: "kyounoryouri",
      negativeTier: "hard",
    });
    expect(
      classifyKnownUrl("https://delishkitchen.tv/company"),
    ).toBeNull();
  });
});
