import { describe, expect, it } from "vitest";
import {
  geminiUrlContextCostUsd,
  parseGeminiUrlContextResponse,
} from "../../poc/ai-extraction/gemini-url-context.js";

describe("parseGeminiUrlContextResponse", () => {
  it("extracts output, retrieval evidence, and all billable token groups", () => {
    const parsed = parseGeminiUrlContextResponse({
      candidates: [
        {
          content: { parts: [{ text: '{"title":"親子丼"}' }] },
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://example.test/recipe",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 20,
        toolUsePromptTokenCount: 1_000,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 30,
        cachedContentTokenCount: 5,
      },
    });
    expect(parsed.outputText).toBe('{"title":"親子丼"}');
    expect(parsed.retrievals).toEqual([
      {
        url: "https://example.test/recipe",
        status: "URL_RETRIEVAL_STATUS_SUCCESS",
      },
    ]);
    expect(parsed.usage).toEqual({
      inputTokens: 1_020,
      outputTokens: 80,
      cachedInputTokens: 5,
    });
    expect(geminiUrlContextCostUsd(parsed.usage)).toBeCloseTo(0.000506, 9);
  });
});
