const SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUS = new Set([429, 529]);

export const DEFAULT_JEV_MODEL = "jev-1.13.0";
export const JEV_INPUT_USD_PER_MILLION = 0.042;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SleepLike = (delayMs: number) => Promise<void>;

export interface JevRecipeClassification {
  model: string;
  choice: "recipe" | "non_recipe";
  recipeProbability: number;
  nonRecipeProbability: number;
  confidence: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  attempts: number;
}

export interface JevRecipeClassificationOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

export class JevRecipeClassificationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "JevRecipeClassificationError";
    this.attempts = attempts;
  }
}

export function jevHttpAttemptsFromError(error: unknown): number {
  return error instanceof JevRecipeClassificationError ? error.attempts : 0;
}

function classificationError(
  error: unknown,
  attempts: number,
): JevRecipeClassificationError {
  const message = error instanceof Error ? error.message : String(error);
  return new JevRecipeClassificationError(message, attempts);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`TypeSafe response field ${field} is not an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`TypeSafe response field ${field} is not a number`);
  }
  return value;
}

function probability(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`TypeSafe response field ${field} is not a probability`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `TypeSafe response field ${field} is not a non-negative integer`,
    );
  }
  return parsed;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function choice(value: unknown): "recipe" | "non_recipe" {
  if (value === "recipe" || value === "non_recipe") return value;
  throw new Error("TypeSafe returned an unknown recipe classification");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 30_000);
    }
  }
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), 5_000);
}

async function postSystemOne(
  body: string,
  apiKey: string,
  timeoutMs: number,
  maxAttempts: number,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike,
): Promise<{ raw: string; attempts: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(SYSTEM_ONE_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw classificationError(error, attempt);
      }
      await sleepImpl(retryDelayMs(null, attempt));
      continue;
    }

    const raw = await response.text();
    if (response.ok) return { raw, attempts: attempt };

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxAttempts) {
      throw new JevRecipeClassificationError(
        `TypeSafe API returned HTTP ${response.status}`,
        attempt,
      );
    }

    await sleepImpl(retryDelayMs(response, attempt));
  }

  throw new JevRecipeClassificationError(
    "TypeSafe API retry loop exhausted unexpectedly",
    maxAttempts,
  );
}

export async function classifyRecipeContent(
  pageContent: string,
  options: JevRecipeClassificationOptions,
): Promise<JevRecipeClassification> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
  if (!pageContent.trim()) throw new Error("page content is empty");

  const model = options.model?.trim() || DEFAULT_JEV_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );
  const maxAttempts = positiveInteger(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const startedAt = Date.now();

  const requestBody = JSON.stringify({
    model,
    state: {
      page_content: pageContent,
    },
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
  });

  const { raw, attempts } = await postSystemOne(
    requestBody,
    apiKey,
    timeoutMs,
    maxAttempts,
    fetchImpl,
    sleepImpl,
  );

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("TypeSafe API returned non-JSON content");
    }

    const root = record(parsed, "root");
    const answers = record(root.answers, "answers");
    const answer = record(
      answers.recipe_classification,
      "answers.recipe_classification",
    );
    if (answer.type !== "choice") {
      throw new Error("TypeSafe returned an unexpected answer type");
    }

    const probabilities = record(
      answer.probabilities,
      "answers.recipe_classification.probabilities",
    );
    const recipeProbability = probability(
      probabilities.recipe,
      "probabilities.recipe",
    );
    const nonRecipeProbability = probability(
      probabilities.non_recipe,
      "probabilities.non_recipe",
    );
    const probabilityTotal = recipeProbability + nonRecipeProbability;
    if (Math.abs(probabilityTotal - 1) > 0.001) {
      throw new Error("TypeSafe choice probabilities do not sum to one");
    }

    const usage = record(root.usage, "usage");
    const inputTokens = nonNegativeInteger(
      usage.input_tokens,
      "usage.input_tokens",
    );
    const outputTokens = nonNegativeInteger(
      usage.output_tokens,
      "usage.output_tokens",
    );

    return {
      model: typeof root.model === "string" ? root.model : model,
      choice: choice(answer.choice),
      recipeProbability,
      nonRecipeProbability,
      confidence: probability(answer.confidence, "answer.confidence"),
      inputTokens,
      outputTokens,
      estimatedCostUsd: (inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000,
      elapsedMs: Date.now() - startedAt,
      attempts,
    };
  } catch (error) {
    if (error instanceof JevRecipeClassificationError) throw error;
    throw classificationError(error, attempts);
  }
}
