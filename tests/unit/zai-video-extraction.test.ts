import { afterEach, describe, expect, it, vi } from "vitest";
import { ZaiRecipeExtractor } from "../../src/infrastructure/ai/zai-recipe-extractor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ZaiRecipeExtractor video input", () => {
  it("sends a signed video URL to GLM-5.3-Flash as video_url content", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request.model).toBe("glm-5.3-flash");
      const messages = request.messages as Array<Record<string, unknown>>;
      const systemMessage = messages.find(
        (message) => message.role === "system",
      );
      expect(systemMessage?.content).toEqual(
        expect.stringContaining(
          "Write every user-visible string value in natural Japanese",
        ),
      );
      for (const field of [
        "title",
        "servings.raw",
        "ingredients[].name",
        "ingredients[].amount",
        "steps[]",
      ]) {
        expect(systemMessage?.content).toEqual(expect.stringContaining(field));
      }
      expect(systemMessage?.content).toEqual(
        expect.stringContaining("Keep JSON property names unchanged"),
      );
      expect(request.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: { url: "https://storage.example/signed-video" },
              },
              expect.objectContaining({ type: "text" }),
            ],
          }),
        ]),
      );
      return new Response(
        JSON.stringify({
          request_id: "video-request",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "パスタ",
                  servings: null,
                  cookingTimeMinutes: null,
                  genre: "麺",
                  ingredients: [{ name: "パスタ", amount: "100g" }],
                  steps: ["茹でる"],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const extractor = new ZaiRecipeExtractor("test-api-key");

    const result = await extractor.extractVideo(
      {
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/video/123",
        imageUrl: null,
        textForAi: "TITLE\nパスタ",
      },
      "https://storage.example/signed-video",
    );

    expect(result.recipe.ingredients).toHaveLength(1);
    expect(result.providerRequestId).toBe("video-request");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
