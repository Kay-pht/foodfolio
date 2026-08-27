export interface Recipe {
  title: string | null;
  servings: { value: number | null; raw: string | null } | null;
  cookingTimeMinutes: number | null;
  genre:
    | "主菜"
    | "副菜"
    | "主食"
    | "麺"
    | "スープ・汁物"
    | "サラダ"
    | "デザート"
    | "その他"
    | null;
  ingredients: Array<{ name: string; amount: string | null }>;
  steps: string[];
}

export interface ExpectedFixture {
  id: string;
  sourceUrl: string;
  recipe: Recipe;
}

export type ProviderName = "gemini" | "openai" | "zai" | "deepseek";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ProviderResponse {
  provider: ProviderName;
  model: string;
  outputText: string;
  usage: Usage;
  elapsedMs: number;
  requestId: string | null;
  rawResponse: unknown;
}

export interface Evaluation {
  jsonParseSuccess: boolean;
  schemaSuccess: boolean;
  schemaErrors: string[];
  titleMatch: boolean;
  servingsMatch: boolean | null;
  cookingTimeMatch: boolean | null;
  genreMatch: boolean;
  ingredientTruePositive: number;
  ingredientFalsePositive: number;
  ingredientFalseNegative: number;
  ingredientAmountExact: number;
  ingredientAmountCompared: number;
  stepTruePositive: number;
  stepFalsePositive: number;
  stepFalseNegative: number;
  hallucinationCount: number;
}
