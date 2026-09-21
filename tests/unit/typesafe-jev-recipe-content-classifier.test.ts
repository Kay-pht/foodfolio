import { describe, expect, it, vi } from "vitest";
import { RecipeContentClassifierError } from "../../src/application/analysis/types.js";
import {
  DEFAULT_JEV_MODEL,
  TypeSafeJevRecipeContentClassifier,
} from "../../src/infrastructure/ai/typesafe-jev-recipe-content-classifier.js";

const validBody = () => ({
  model: DEFAULT_JEV_MODEL,
  answers: {
    recipe_classification: {
      type: "choice",
      choice: "recipe",
      probabilities: {
        recipe: 0.995,
        non_recipe: 0.005,
      },
    },
  },
});

describe("TypeSafeJevRecipeContentClassifier", () => {
  it("uses the production Jev schema and parses a valid choice response", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          state: { page_content: string };
          questions: Record<string, unknown>;
        };
        expect(body.model).toBe(DEFAULT_JEV_MODEL);
        expect(body.state.page_content).toBe("normalized recipe text");
        expect(body.questions).toHaveProperty("recipe_classification");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer test-key",
          "content-type": "application/json",
        });
        return new Response(JSON.stringify(validBody()), { status: 200 });
      },
    );
    const classifier = new TypeSafeJevRecipeContentClassifier(
      "test-key",
      fetchImpl,
    );

    await expect(
      classifier.classify({ text: "normalized recipe text" }),
    ).resolves.toMatchObject({
      model: DEFAULT_JEV_MODEL,
      choice: "recipe",
      recipeProbability: 0.995,
      nonRecipeProbability: 0.005,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["timeout", Object.assign(new Error("timeout"), { name: "TimeoutError" })],
    ["network", new Error("connection reset")],
  ] as const)(
    "classifies %s failures without retrying",
    async (failureClass, error) => {
      const fetchImpl = vi.fn(async () => {
        throw error;
      });
      const classifier = new TypeSafeJevRecipeContentClassifier(
        "test-key",
        fetchImpl,
      );

      await expect(
        classifier.classify({ text: "recipe" }),
      ).rejects.toMatchObject({
        name: "RecipeContentClassifierError",
        failureClass,
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [429, "http_429"],
    [529, "http_529"],
    [500, "http_error"],
  ] as const)(
    "classifies HTTP %s as %s without retrying",
    async (status, failureClass) => {
      const fetchImpl = vi.fn(
        async () => new Response("provider error", { status }),
      );
      const classifier = new TypeSafeJevRecipeContentClassifier(
        "test-key",
        fetchImpl,
      );

      await expect(
        classifier.classify({ text: "recipe" }),
      ).rejects.toMatchObject({
        name: "RecipeContentClassifierError",
        failureClass,
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("classifies response body read failures without retrying", async () => {
    const response = {
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("stream reset");
      },
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => response);
    const classifier = new TypeSafeJevRecipeContentClassifier(
      "test-key",
      fetchImpl,
    );

    await expect(classifier.classify({ text: "recipe" })).rejects.toMatchObject(
      {
        name: "RecipeContentClassifierError",
        failureClass: "body_read",
      },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["not JSON", "not-json"],
    [
      "unknown choice",
      JSON.stringify({
        ...validBody(),
        answers: {
          recipe_classification: {
            ...validBody().answers.recipe_classification,
            choice: "maybe",
          },
        },
      }),
    ],
    [
      "out of range probability",
      JSON.stringify({
        ...validBody(),
        answers: {
          recipe_classification: {
            ...validBody().answers.recipe_classification,
            probabilities: { recipe: 1.1, non_recipe: -0.1 },
          },
        },
      }),
    ],
    [
      "probabilities not summing to one",
      JSON.stringify({
        ...validBody(),
        answers: {
          recipe_classification: {
            ...validBody().answers.recipe_classification,
            probabilities: { recipe: 0.8, non_recipe: 0.3 },
          },
        },
      }),
    ],
  ] as const)("rejects %s as an invalid response", async (_name, body) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    const classifier = new TypeSafeJevRecipeContentClassifier(
      "test-key",
      fetchImpl,
    );

    const error = await classifier
      .classify({ text: "recipe" })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RecipeContentClassifierError);
    expect(error).toMatchObject({ failureClass: "invalid_response" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
