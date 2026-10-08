import { afterEach, describe, expect, it, vi } from "vitest";
import { ZaiRecipeExtractor } from "../../src/infrastructure/ai/zai-recipe-extractor.js";

afterEach(() => vi.unstubAllGlobals());

const recipe = {
  title: "にんじんサラダ",
  servings: null,
  cookingTimeMinutes: null,
  genre: "サラダ",
  ingredients: [{ name: "にんじん", amount: "2本" }],
  steps: ["混ぜる"],
};

describe("Instagram media completion settings", () => {
  it("sends the validated completion candidate for Instagram media", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(recipe) },
              },
            ],
            usage: { prompt_tokens: 26522, completion_tokens: 323 },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ZaiRecipeExtractor("test-key").extractMedia(
      {
        sourceType: "instagram",
        resolvedUrl: "https://www.instagram.com/reel/fixture/",
        imageUrl: null,
        textForAi: "にんじんサラダ",
      },
      [
        {
          index: 1,
          kind: "video",
          url: "https://storage.example/video.mp4",
          contentType: "video/mp4",
          dispose: async () => {},
        },
      ],
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_tokens: 10000,
      reasoning_effort: "low",
      stream: false,
      response_format: { type: "json_object" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result.recipe).toEqual(recipe);
  });

  it.each([
    { sourceType: "instagram" as const, mode: "text", expected: 10000 },
    { sourceType: "web" as const, mode: "text", expected: 4000 },
    { sourceType: "youtube" as const, mode: "text", expected: 4000 },
    { sourceType: "tiktok" as const, mode: "text", expected: 4000 },
    { sourceType: "tiktok" as const, mode: "media", expected: 4000 },
    { sourceType: "tiktok" as const, mode: "video", expected: 4000 },
    { sourceType: "instagram" as const, mode: "video", expected: 10000 },
  ])(
    "preserves scope for $sourceType $mode",
    async ({ sourceType, mode, expected }) => {
      const fetchMock = vi.fn<
        (url: string, init?: RequestInit) => Promise<Response>
      >(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(recipe) } }],
            }),
          ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const extractor = new ZaiRecipeExtractor("test-key");
      const source = {
        sourceType,
        resolvedUrl: "https://www.instagram.com/p/fixture/",
        imageUrl: null,
        textForAi: "にんじんサラダ",
      };
      if (mode === "text") await extractor.extract(source);
      else if (mode === "video")
        await extractor.extractVideo(
          source,
          "https://storage.example/video.mp4",
        );
      else
        await extractor.extractMedia(source, [
          {
            index: 1,
            kind: "image",
            url: "https://storage.example/image.jpg",
            contentType: "image/jpeg",
            dispose: async () => {},
          },
        ]);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.max_tokens).toBe(expected);
      if (expected === 10000) expect(body.reasoning_effort).toBe("low");
      else expect(body).not.toHaveProperty("reasoning_effort");
    },
  );

  it("keeps empty length output as a failure with the selected media limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "length",
                  message: {
                    content: "",
                    reasoning_content: "private reasoning",
                  },
                },
              ],
              usage: { prompt_tokens: 26527, completion_tokens: 10000 },
            }),
          ),
      ),
    );
    await expect(
      new ZaiRecipeExtractor("test-key").extractMedia(
        {
          sourceType: "instagram",
          resolvedUrl: "https://www.instagram.com/reel/fixture/",
          imageUrl: null,
          textForAi: null,
        },
        [
          {
            index: 1,
            kind: "video",
            url: "https://storage.example/video.mp4",
            contentType: "video/mp4",
            dispose: async () => {},
          },
        ],
      ),
    ).rejects.toMatchObject({
      code: "AI_INVALID_JSON",
      retryable: true,
      diagnostics: {
        aiFailureStage: "content_invalid_json",
        providerFinishReason: "length",
        responseContentChars: 0,
        maxOutputTokens: 10000,
      },
    });
  });
});
