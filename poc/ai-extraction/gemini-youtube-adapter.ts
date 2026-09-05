import {
  AnalysisError,
  type ExtractedRecipe,
  type RecipeExtractionResult,
} from "../../src/application/analysis/types.js";
import { callYoutube, inspectYoutubeResponse } from "./gemini-youtube.js";

// PoC only: the caller must verify disabled billing before a real API call.
// This is deliberately not wired into the production Worker.
export async function extractYoutubeForPoc(
  url: string,
  description: string,
  apiKey: string,
  request: typeof fetch,
): Promise<RecipeExtractionResult> {
  let response;
  try {
    response = await callYoutube(url, apiKey, request, description, true);
  } catch (error) {
    const timeout =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name);
    throw new AnalysisError(
      timeout ? "AI_TIMEOUT" : "AI_RESPONSE_ERROR",
      false,
      "Gemini PoC request failed; no automatic retry",
    );
  }
  if (response.httpStatus < 200 || response.httpStatus >= 300) {
    throw new AnalysisError(
      response.httpStatus === 429 ? "AI_RATE_LIMITED" : "AI_RESPONSE_ERROR",
      false,
      `Gemini PoC HTTP ${response.httpStatus}`,
    );
  }
  let inspected;
  try {
    inspected = inspectYoutubeResponse(response.raw);
  } catch {
    throw new AnalysisError(
      "AI_RESPONSE_ERROR",
      false,
      "Malformed Gemini response",
    );
  }
  if (
    inspected.finishReason !== "STOP" ||
    !inspected.schemaValid ||
    !inspected.nonemptyRecipe
  ) {
    throw new AnalysisError(
      "SOURCE_CONTENT_UNAVAILABLE",
      false,
      "Gemini response is incomplete, invalid, or empty",
    );
  }
  const usage = inspected.usageMetadata as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  } | null;
  return {
    recipe: inspected.recipe as ExtractedRecipe,
    providerRequestId: null,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens:
      (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    latencyMs: response.elapsedMs,
  };
}
