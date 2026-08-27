import { describe, expect, it } from "vitest";
import { classifySources } from "../../poc/url-extraction/classify.js";
import type { UrlExtractionResult } from "../../poc/url-extraction/types.js";

function result(
  id: string,
  source: UrlExtractionResult["source"],
  usable: boolean,
  kind: UrlExtractionResult["kind"] = "recipe",
): UrlExtractionResult {
  return {
    id,
    source,
    url: `https://example.test/${id}`,
    finalUrl: `https://example.test/${id}`,
    kind,
    capturedAt: "2026-08-27T00:00:00.000Z",
    http: {
      ok: true,
      status: 200,
      contentType: "text/html",
      bytes: 100,
      elapsedMs: 10,
    },
    metadata: {
      title: null,
      description: null,
      imageUrl: null,
      authorName: null,
    },
    jsonLdRecipes: [],
    evidence: {
      textLength: usable ? 200 : 10,
      textSha256: "hash",
      hasRecipeSignals: usable,
      jsRequiredSignal: false,
      authRequiredSignal: false,
      extractionMethods: ["http-html"],
    },
    aiInput: { usable, reason: "test", text: usable ? "recipe" : "" },
    error: null,
  };
}

describe("classifySources", () => {
  it("uses the agreed 3-case classification and excludes controls", () => {
    const summaries = classifySources([
      result("a1", "general-web", true),
      result("a2", "general-web", true),
      result("a3", "general-web", true),
      result("b1", "tiktok", true),
      result("b2", "tiktok", false),
      result("b3", "tiktok", false),
      result("control", "general-web", false, "non-recipe"),
    ]);
    expect(summaries).toMatchObject([
      {
        source: "general-web",
        recipeCases: 3,
        aiUsableCases: 3,
        classification: "available",
      },
      {
        source: "tiktok",
        recipeCases: 3,
        aiUsableCases: 1,
        classification: "conditional",
      },
    ]);
  });
});
