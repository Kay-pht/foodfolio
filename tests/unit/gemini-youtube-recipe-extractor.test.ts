import { describe, expect, it, vi } from "vitest";
import {
  buildYoutubeGeminiRequest,
  GeminiYoutubeRecipeExtractor,
  mapYoutubeGeminiEvidence,
  type YoutubeGeminiEvidenceRecipe,
} from "../../src/infrastructure/ai/gemini-youtube-recipe-extractor.js";

const source = {
  sourceType: "youtube" as const,
  resolvedUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
  imageUrl: null,
  textForAi: "TITLE\nハンバーグ",
  youtubeDescription: "材料情報なし",
};

const evidence = (overrides: Partial<YoutubeGeminiEvidenceRecipe> = {}) => ({
  title: "ハンバーグ",
  servings: {
    raw: "4人分",
    kind: "people" as const,
    value: 4,
    evidenceText: "4人分",
    evidenceSource: "description_materials" as const,
  },
  cookingTimeMinutes: null,
  genre: "主菜",
  ingredients: [
    {
      name: "ケチャップ",
      amountText: "好みで",
      evidenceText: "ケチャップは好みで",
      evidenceSource: "description_materials" as const,
    },
    {
      name: "塩",
      amountText: "少々",
      evidenceText: "塩 少々",
      evidenceSource: "description_materials" as const,
    },
    {
      name: "水",
      amountText: "50cc",
      evidenceText: "水50ccを加える",
      evidenceSource: "description_steps" as const,
    },
  ],
  procedureOnlyIngredients: [
    {
      name: "サラダ油",
      amountText: null,
      evidenceText: "油をひいて焼く",
      evidenceSource: "video_audio" as const,
    },
  ],
  steps: ["材料を混ぜる", "油をひいて焼く"],
  ...overrides,
});

const geminiResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "gemini-1" },
  });

describe("GeminiYoutubeRecipeExtractor", () => {
  it("sends the public URL and description in one request and maps evidence", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          contents: Array<{ parts: Array<Record<string, unknown>> }>;
        };
        expect(request.contents[0]?.parts).toContainEqual({
          fileData: {
            fileUri: source.resolvedUrl,
            mimeType: "video/mp4",
          },
        });
        expect(JSON.stringify(request)).toContain(source.youtubeDescription);
        return geminiResponse({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(evidence()) }] },
            },
          ],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        });
      },
    );
    const extractor = new GeminiYoutubeRecipeExtractor(
      "test-key",
      fetchImpl as typeof fetch,
    );

    await expect(extractor.extract(source)).resolves.toEqual({
      recipe: {
        title: "ハンバーグ",
        servings: { value: 4, raw: "4人分" },
        cookingTimeMinutes: null,
        genre: "主菜",
        ingredients: [
          { name: "ケチャップ", amount: "好みで" },
          { name: "塩", amount: "少々" },
          { name: "水", amount: "50cc" },
          { name: "サラダ油", amount: "適量" },
        ],
        steps: ["材料を混ぜる", "油をひいて焼く"],
      },
      provider: "gemini",
      providerRequestId: "gemini-1",
      inputTokens: 100,
      outputTokens: 20,
      latencyMs: expect.any(Number),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps count yield raw without converting it to people", () => {
    expect(
      mapYoutubeGeminiEvidence(
        evidence({
          servings: {
            raw: "8個分",
            kind: "count",
            value: 8,
            evidenceText: "8個できました",
            evidenceSource: "video_audio",
          },
        }),
      ).servings,
    ).toEqual({ value: null, raw: "8個分" });
  });

  it("does not turn an ingredient count into servings", () => {
    expect(
      mapYoutubeGeminiEvidence(
        evidence({
          servings: {
            raw: "卵2個",
            kind: "count",
            value: 2,
            evidenceText: "卵2個",
            evidenceSource: "description_materials",
          },
        }),
      ).servings,
    ).toBeNull();
  });

  it("keeps a people range raw without inventing one value", () => {
    expect(
      mapYoutubeGeminiEvidence(
        evidence({
          servings: {
            raw: "1〜2人分",
            kind: "range",
            value: null,
            evidenceText: "1〜2人分",
            evidenceSource: "description_materials",
          },
        }),
      ).servings,
    ).toEqual({ value: null, raw: "1〜2人分" });
  });

  it.each([400, 404, 429, 503])(
    "fails without retry on HTTP %s",
    async (status) => {
      const extractor = new GeminiYoutubeRecipeExtractor(
        "test-key",
        vi.fn(async () =>
          geminiResponse({}, status),
        ) as unknown as typeof fetch,
      );
      await expect(extractor.extract(source)).rejects.toMatchObject({
        code: `YOUTUBE_GEMINI_HTTP_${status}`,
        retryable: false,
      });
    },
  );

  it.each([
    ["missing candidate", {}, "YOUTUBE_GEMINI_ENVELOPE_INVALID"],
    [
      "safety block",
      { promptFeedback: { blockReason: "SAFETY" } },
      "YOUTUBE_GEMINI_SAFETY_BLOCKED",
    ],
    [
      "max tokens",
      { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] },
      "YOUTUBE_GEMINI_OUTPUT_TRUNCATED",
    ],
    [
      "abnormal finish",
      { candidates: [{ finishReason: "OTHER", content: { parts: [] } }] },
      "YOUTUBE_GEMINI_FINISH_REASON_INVALID",
    ],
    [
      "invalid output JSON",
      {
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "{" }] } },
        ],
      },
      "YOUTUBE_GEMINI_INVALID_JSON",
    ],
    [
      "schema mismatch",
      {
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "{}" }] } },
        ],
      },
      "YOUTUBE_GEMINI_SCHEMA_INVALID",
    ],
    [
      "empty ingredients",
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify(
                    evidence({ ingredients: [], procedureOnlyIngredients: [] }),
                  ),
                },
              ],
            },
          },
        ],
      },
      "YOUTUBE_GEMINI_RECIPE_INCOMPLETE",
    ],
    [
      "empty steps",
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: JSON.stringify(evidence({ steps: [] })) }],
            },
          },
        ],
      },
      "YOUTUBE_GEMINI_RECIPE_INCOMPLETE",
    ],
  ])("rejects %s", async (_name, body, code) => {
    const extractor = new GeminiYoutubeRecipeExtractor(
      "test-key",
      vi.fn(async () => geminiResponse(body)) as unknown as typeof fetch,
    );
    await expect(extractor.extract(source)).rejects.toMatchObject({ code });
  });

  it("fails clearly when the API key is missing without making a request", async () => {
    const fetchImpl = vi.fn();
    const extractor = new GeminiYoutubeRecipeExtractor(
      "",
      fetchImpl as typeof fetch,
    );
    await expect(extractor.extract(source)).rejects.toMatchObject({
      code: "YOUTUBE_GEMINI_API_KEY_MISSING",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("builds a request even when the description is empty", () => {
    expect(buildYoutubeGeminiRequest(source.resolvedUrl, "")).toBeTruthy();
  });
});
