import {
  RecipeContentClassifierError,
  type RecipeContentClassification,
  type RecipeContentClassifier,
} from "../../application/analysis/types.js";

const SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const DEFAULT_JEV_MODEL = "jev-1.13.0";
export const DEFAULT_JEV_TIMEOUT_MS = 3_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class TypeSafeJevRecipeContentClassifier implements RecipeContentClassifier {
  readonly model: string;
  private readonly apiKey: string;

  constructor(
    apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    model = DEFAULT_JEV_MODEL,
    private readonly timeoutMs = DEFAULT_JEV_TIMEOUT_MS,
  ) {
    this.apiKey = apiKey.trim();
    this.model = model.trim() || DEFAULT_JEV_MODEL;
    if (!this.apiKey)
      throw new Error("TYPESAFE_API_KEY is required for Jev classification");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
      throw new Error("Jev timeout must be a positive integer");
  }

  async classify(input: {
    text: string;
  }): Promise<RecipeContentClassification> {
    if (!input.text.trim())
      throw new Error("Jev classifier input must not be empty");

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(SYSTEM_ONE_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          state: { page_content: input.text },
          questions: {
            recipe_classification: {
              type: "choice",
              instructions:
                "Classify whether the provided page content represents one specific cooking recipe.",
              criteria: {
                recipe:
                  "One specific dish or drink recipe, or content clearly intended to teach how to prepare one specific dish or drink. Missing some fields in the extracted page text does not by itself make it non-recipe.",
                non_recipe:
                  "Not one specific cooking recipe. Includes home pages, search/list/category/index pages, general food articles, product/news/editorial pages, and unrelated content.",
              },
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const failureClass =
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "network";
      throw new RecipeContentClassifierError(
        failureClass,
        Date.now() - startedAt,
        "TypeSafe Jev request failed",
      );
    }

    let raw: string;
    try {
      raw = await response.text();
    } catch {
      throw new RecipeContentClassifierError(
        "body_read",
        Date.now() - startedAt,
        "TypeSafe Jev response body could not be read",
      );
    }

    if (!response.ok) {
      const failureClass =
        response.status === 429
          ? "http_429"
          : response.status === 529
            ? "http_529"
            : "http_error";
      throw new RecipeContentClassifierError(
        failureClass,
        Date.now() - startedAt,
        `TypeSafe Jev returned HTTP ${response.status}`,
      );
    }

    try {
      const root = asRecord(JSON.parse(raw), "root");
      const answers = asRecord(root.answers, "answers");
      const answer = asRecord(
        answers.recipe_classification,
        "answers.recipe_classification",
      );
      if (answer.type !== "choice")
        throw new Error("TypeSafe Jev returned an unexpected answer type");
      const choice = parseChoice(answer.choice);
      const probabilities = asRecord(
        answer.probabilities,
        "answers.recipe_classification.probabilities",
      );
      const recipeProbability = parseProbability(
        probabilities.recipe,
        "probabilities.recipe",
      );
      const nonRecipeProbability = parseProbability(
        probabilities.non_recipe,
        "probabilities.non_recipe",
      );
      if (Math.abs(recipeProbability + nonRecipeProbability - 1) > 0.001)
        throw new Error("TypeSafe Jev probabilities do not sum to one");

      return {
        model: typeof root.model === "string" ? root.model : this.model,
        choice,
        recipeProbability,
        nonRecipeProbability,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw new RecipeContentClassifierError(
        "invalid_response",
        Date.now() - startedAt,
        error instanceof Error
          ? error.message
          : "TypeSafe Jev response was invalid",
      );
    }
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`TypeSafe Jev response field ${field} is not an object`);
  return value as Record<string, unknown>;
}

function parseProbability(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error(
      `TypeSafe Jev response field ${field} is not a probability`,
    );
  return value;
}

function parseChoice(value: unknown): "recipe" | "non_recipe" {
  if (value === "recipe" || value === "non_recipe") return value;
  throw new Error("TypeSafe Jev returned an unknown classification");
}
