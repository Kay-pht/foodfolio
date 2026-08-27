import { describe, expect, it } from "vitest";
import {
  aggregateByProvider,
  selectProvider,
} from "../../poc/ai-extraction/aggregate.js";
import type { Evaluation } from "../../poc/ai-extraction/types.js";
import { resolveProviders } from "../../poc/ai-extraction/providers.js";

const perfect: Evaluation = {
  jsonParseSuccess: true,
  schemaSuccess: true,
  schemaErrors: [],
  titleMatch: true,
  servingsMatch: true,
  cookingTimeMatch: true,
  genreMatch: true,
  ingredientTruePositive: 9,
  ingredientFalsePositive: 0,
  ingredientFalseNegative: 0,
  ingredientAmountExact: 9,
  ingredientAmountCompared: 9,
  stepTruePositive: 9,
  stepActualMatched: 9,
  stepExpectedMatched: 9,
  stepFalsePositive: 0,
  stepFalseNegative: 0,
  hallucinationCount: 0,
};

describe("aggregateByProvider", () => {
  it("selects the cheapest provider only after all thresholds pass", () => {
    const metrics = aggregateByProvider([
      {
        provider: "openai",
        model: "model-a",
        elapsedMs: 100,
        costUsd: 0.02,
        evaluation: perfect,
        error: null,
      },
      {
        provider: "zai",
        model: "model-b",
        elapsedMs: 200,
        costUsd: 0.01,
        evaluation: perfect,
        error: null,
      },
    ]);
    expect(metrics.every(({ passesAcceptance }) => passesAcceptance)).toBe(
      true,
    );
    expect(selectProvider(metrics)?.provider).toBe("zai");
  });

  it("rejects a provider with one hallucination", () => {
    const metrics = aggregateByProvider([
      {
        provider: "openai",
        model: "model-a",
        elapsedMs: 100,
        costUsd: 0.02,
        evaluation: { ...perfect, hallucinationCount: 1 },
        error: null,
      },
    ]);
    expect(metrics[0]?.passesAcceptance).toBe(false);
    expect(selectProvider(metrics)).toBeNull();
  });
});

describe("resolveProviders", () => {
  it("limits paid evaluation to the explicitly requested provider", () => {
    expect(resolveProviders("zai")).toEqual(["zai"]);
  });

  it("rejects an unknown provider instead of silently calling others", () => {
    expect(() => resolveProviders("zai,unknown")).toThrow(
      "unknown providers: unknown",
    );
  });
});
