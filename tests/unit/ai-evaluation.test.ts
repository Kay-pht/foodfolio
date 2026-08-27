import { describe, expect, it } from "vitest";
import {
  parseAndEvaluate,
  textSimilarity,
} from "../../poc/ai-extraction/evaluate.js";
import type { Recipe } from "../../poc/ai-extraction/types.js";

const expected: Recipe = {
  title: "豚バラ白菜",
  servings: { value: 2, raw: "2人分" },
  cookingTimeMinutes: 20,
  genre: "主菜",
  ingredients: [
    { name: "白菜", amount: "500g" },
    { name: "豚バラ肉", amount: "200g" },
  ],
  steps: ["白菜を切る", "豚肉を炒める"],
};

describe("parseAndEvaluate", () => {
  it("reports a fully faithful structured recipe", () => {
    const { evaluation } = parseAndEvaluate(JSON.stringify(expected), expected);
    expect(evaluation).toMatchObject({
      jsonParseSuccess: true,
      schemaSuccess: true,
      titleMatch: true,
      servingsMatch: true,
      cookingTimeMatch: true,
      genreMatch: true,
      ingredientTruePositive: 2,
      ingredientFalsePositive: 0,
      ingredientFalseNegative: 0,
      ingredientAmountExact: 2,
      stepTruePositive: 2,
      stepFalsePositive: 0,
      stepFalseNegative: 0,
      hallucinationCount: 0,
    });
  });

  it("counts unsupported ingredients and steps as hallucinations", () => {
    const actual: Recipe = {
      ...expected,
      ingredients: [
        ...expected.ingredients,
        { name: "にんじん", amount: "1本" },
      ],
      steps: [...expected.steps, "チーズをかける"],
    };
    const { evaluation } = parseAndEvaluate(JSON.stringify(actual), expected);
    expect(evaluation.ingredientFalsePositive).toBe(1);
    expect(evaluation.stepFalsePositive).toBe(1);
    expect(evaluation.hallucinationCount).toBe(2);
  });

  it("rejects malformed JSON", () => {
    const { recipe, evaluation } = parseAndEvaluate("not json", expected);
    expect(recipe).toBeNull();
    expect(evaluation.jsonParseSuccess).toBe(false);
    expect(evaluation.schemaSuccess).toBe(false);
  });
});

describe("textSimilarity", () => {
  it("recognizes a faithful paraphrase with shared operations", () => {
    expect(
      textSimilarity("豚肉をごま油で炒める", "ごま油を熱して豚肉を炒める"),
    ).toBeGreaterThan(0.28);
  });
});
