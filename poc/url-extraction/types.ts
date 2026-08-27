export type SourceName =
  "general-web" | "kurashiru" | "cookpad" | "youtube" | "instagram" | "tiktok";

export interface UrlCase {
  id: string;
  source: SourceName;
  url: string;
  kind: "recipe" | "non-recipe";
}

export interface RecipeJsonLd {
  name: string | null;
  recipeYield: string | null;
  totalTime: string | null;
  recipeCategory: string | null;
  recipeIngredient: string[];
  recipeInstructions: string[];
}

export interface UrlExtractionResult {
  id: string;
  source: SourceName;
  url: string;
  finalUrl: string;
  kind: UrlCase["kind"];
  capturedAt: string;
  http: {
    ok: boolean;
    status: number;
    contentType: string | null;
    bytes: number;
    elapsedMs: number;
  };
  metadata: {
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    authorName: string | null;
  };
  jsonLdRecipes: RecipeJsonLd[];
  evidence: {
    textLength: number;
    textSha256: string;
    hasRecipeSignals: boolean;
    jsRequiredSignal: boolean;
    authRequiredSignal: boolean;
    extractionMethods: string[];
  };
  aiInput: {
    usable: boolean;
    reason: string;
    text: string;
  };
  error: string | null;
}
