import type { SourceType } from "../../generated/prisma/client.js";

export interface SourceContent {
  sourceType: SourceType;
  resolvedUrl: string;
  imageUrl: string | null;
  textForAi: string | null;
}
export interface ExtractedRecipe {
  title: string | null;
  servings: { value: number | null; raw: string | null } | null;
  cookingTimeMinutes: number | null;
  genre: string | null;
  ingredients: Array<{ name: string; amount: string | null }>;
  steps: string[];
}

export interface SourceContentExtractor {
  extract(url: URL): Promise<SourceContent>;
}
export interface RecipeExtractor {
  extract(input: SourceContent): Promise<{
    recipe: ExtractedRecipe;
    providerRequestId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }>;
}
export interface NotificationSender {
  sendRecipeAnalysisCompleted(
    tokens: string[],
    recipeId: string,
    title: string,
  ): Promise<string[]>;
  sendRecipeAnalysisFailed(
    tokens: string[],
    recipeId: string,
    title: string,
  ): Promise<string[]>;
}

export class AnalysisError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
