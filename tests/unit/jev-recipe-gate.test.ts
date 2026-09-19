import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  parseBatchSize,
  selectBatchCaseIds,
} from "../../poc/jev-recipe-gate/batch.js";
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
  jevHttpAttemptsFromError,
} from "../../poc/jev-recipe-gate/jev.js";
import {
  evaluateThresholds,
  historicalEstimatedCostAfterRefresh,
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
    expect(result.attempts).toBe(1);
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

  it("retries 429 responses with bounded backoff before succeeding", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await classifyRecipeContent("page content", {
      apiKey: "test-key",
      sleepImpl: async (delayMs) => {
        delays.push(delayMs);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "0.01" },
          });
        }
        return new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: {
              recipe_classification: {
                type: "choice",
                choice: "recipe",
                probabilities: { recipe: 0.99, non_recipe: 0.01 },
                confidence: 0.98,
              },
            },
            usage: { input_tokens: 500, output_tokens: 10 },
          }),
          { status: 200 },
        );
      },
    });

    expect(attempts).toBe(2);
    expect(delays).toEqual([10]);
    expect(result.attempts).toBe(2);
    expect(result.choice).toBe("recipe");
  });

  it("preserves HTTP attempt count when retryable failures exhaust", async () => {
    let requests = 0;
    let caught: unknown;

    try {
      await classifyRecipeContent("page content", {
        apiKey: "test-key",
        maxAttempts: 3,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          requests += 1;
          return new Response("overloaded", { status: 529 });
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(requests).toBe(3);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("HTTP 529");
    expect(jevHttpAttemptsFromError(caught)).toBe(3);
  });

  it("preserves HTTP attempt count when a successful response cannot be parsed", async () => {
    let caught: unknown;

    try {
      await classifyRecipeContent("page content", {
        apiKey: "test-key",
        fetchImpl: async () => new Response("not-json", { status: 200 }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("non-JSON");
    expect(jevHttpAttemptsFromError(caught)).toBe(1);
  });
});

describe("Jev recipe gate checkpoint accounting", () => {
  it("carries forward spend that is no longer represented by refreshed cases", () => {
    const historical = historicalEstimatedCostAfterRefresh(0.75, 0.25);

    expect(historical).toBeCloseTo(0.5);
    expect(historical + 0.25).toBeCloseTo(0.75);
  });

  it("never creates negative historical spend from floating-point drift", () => {
    expect(historicalEstimatedCostAfterRefresh(0.1, 0.1000000000001)).toBe(0);
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
        discoverySite:
          index < 300 ? "site-a" : index < 400 ? "site-b" : "site-c",
        negativeTier: null,
      })),
      ...Array.from({ length: 500 }, (_, index) => ({
        kind: "non-recipe" as const,
        discoverySite:
          index < 300 ? "site-a" : index < 400 ? "site-b" : "site-c",
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
      isKnownRecipeUrl("https://delishkitchen.tv/recipes/378791542590013783"),
    ).toBe(true);
    expect(
      isKnownRecipeUrl("https://oceans-nadia.com/user/11285/recipe/393839"),
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
    expect(classifyKnownUrl("https://delishkitchen.tv/company")).toBeNull();
  });
});

describe("Jev recipe gate batch selection", () => {
  it("defaults to and caps one run at 100 URLs", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(100);
    expect(MAX_BATCH_SIZE).toBe(100);
    expect(parseBatchSize(undefined)).toBe(100);
    expect(() => parseBatchSize("101")).toThrow(
      "JEV_POC_BATCH_SIZE must be an integer from 1 to 100",
    );
  });

  it("selects at most 100 URLs and balances fresh recipe/non-recipe cases", () => {
    const cases = [
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `recipe-${index}`,
        expected: "recipe" as const,
        completedRuns: 0,
        hasTerminalError: false,
      })),
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `non-recipe-${index}`,
        expected: "non-recipe" as const,
        completedRuns: 0,
        hasTerminalError: false,
      })),
    ];

    const selected = selectBatchCaseIds(cases, 3);
    const selectedCases = cases.filter(({ id }) => selected.includes(id));

    expect(selected).toHaveLength(100);
    expect(
      selectedCases.filter(({ expected }) => expected === "recipe"),
    ).toHaveLength(50);
    expect(
      selectedCases.filter(({ expected }) => expected === "non-recipe"),
    ).toHaveLength(50);
  });

  it("resumes partially completed URLs before selecting fresh cases", () => {
    const cases = [
      {
        id: "partial-recipe",
        expected: "recipe" as const,
        completedRuns: 1,
        hasTerminalError: false,
      },
      {
        id: "partial-non-recipe",
        expected: "non-recipe" as const,
        completedRuns: 2,
        hasTerminalError: false,
      },
      ...Array.from({ length: 150 }, (_, index) => ({
        id: `fresh-${index}`,
        expected: (index % 2 === 0 ? "recipe" : "non-recipe") as
          "recipe" | "non-recipe",
        completedRuns: 0,
        hasTerminalError: false,
      })),
    ];

    const selected = selectBatchCaseIds(cases, 3);

    expect(selected).toHaveLength(100);
    expect(selected.slice(0, 2)).toEqual([
      "partial-recipe",
      "partial-non-recipe",
    ]);
  });

  it("prioritizes the URL that hit a persistent API error even before any run succeeded", () => {
    const selected = selectBatchCaseIds(
      [
        {
          id: "fresh-a",
          expected: "recipe",
          completedRuns: 0,
          hasTerminalError: false,
        },
        {
          id: "retry-me",
          expected: "non-recipe",
          completedRuns: 0,
          hasTerminalError: false,
          retryPriority: true,
        },
        {
          id: "fresh-b",
          expected: "non-recipe",
          completedRuns: 0,
          hasTerminalError: false,
        },
      ],
      3,
      2,
    );

    expect(selected[0]).toBe("retry-me");
    expect(selected).toHaveLength(2);
  });

  it("skips fully completed and terminal-error URLs", () => {
    const selected = selectBatchCaseIds(
      [
        {
          id: "done",
          expected: "recipe",
          completedRuns: 3,
          hasTerminalError: false,
        },
        {
          id: "failed",
          expected: "non-recipe",
          completedRuns: 0,
          hasTerminalError: true,
        },
        {
          id: "pending",
          expected: "recipe",
          completedRuns: 0,
          hasTerminalError: false,
        },
      ],
      3,
    );

    expect(selected).toEqual(["pending"]);
  });
});
