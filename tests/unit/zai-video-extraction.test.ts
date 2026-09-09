import { afterEach, describe, expect, it, vi } from "vitest";
import { ZaiRecipeExtractor } from "../../src/infrastructure/ai/zai-recipe-extractor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function successfulResponse(requestId: string) {
  return new Response(
    JSON.stringify({
      request_id: requestId,
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
}

describe("ZaiRecipeExtractor media input", () => {
  it("keeps the existing single-video request shape", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request.model).toBe("glm-5.3-flash");
      const messages = request.messages as Array<Record<string, unknown>>;
      const systemMessage = messages.find(
        (message) => message.role === "system",
      );
      expect(systemMessage?.content).toEqual(
        expect.stringContaining("Always return a non-empty title"),
      );
      expect(systemMessage?.content).toEqual(
        expect.stringContaining(
          "all supplied source evidence, which may include text, images, video, audio, and visible text",
        ),
      );
      expect(systemMessage?.content).toEqual(
        expect.stringContaining(
          "Never invent unsupported ingredients, cooking methods, proper nouns, or dish attributes",
        ),
      );
      expect(systemMessage?.content).toEqual(
        expect.stringContaining(
          "Write every user-visible string value in natural Japanese",
        ),
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
      return successfulResponse("video-request");
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

  it("sends image and video blocks in original Instagram post order", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: unknown }>;
      };
      const user = request.messages.find((message) => message.role === "user");
      expect(user?.content).toEqual([
        {
          type: "image_url",
          image_url: { url: "https://storage.example/1.jpg" },
        },
        {
          type: "video_url",
          video_url: { url: "https://storage.example/2.mp4" },
        },
        {
          type: "image_url",
          image_url: { url: "https://storage.example/3.png" },
        },
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("original post order"),
        }),
      ]);
      return successfulResponse("media-request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const extractor = new ZaiRecipeExtractor("test-api-key");
    const dispose = async () => {};

    const result = await extractor.extractMedia(
      {
        sourceType: "instagram",
        resolvedUrl: "https://www.instagram.com/p/example/",
        imageUrl: null,
        textForAi: "DESCRIPTION\nパスタ",
      },
      [
        {
          index: 3,
          kind: "image",
          url: "https://storage.example/3.png",
          contentType: "image/png",
          dispose,
        },
        {
          index: 1,
          kind: "image",
          url: "https://storage.example/1.jpg",
          contentType: "image/jpeg",
          dispose,
        },
        {
          index: 2,
          kind: "video",
          url: "https://storage.example/2.mp4",
          contentType: "video/mp4",
          dispose,
        },
      ],
    );

    expect(result.providerRequestId).toBe("media-request");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a non-contiguous media collection before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const extractor = new ZaiRecipeExtractor("test-api-key");

    await expect(
      extractor.extractMedia(
        {
          sourceType: "instagram",
          resolvedUrl: "https://www.instagram.com/p/example/",
          imageUrl: null,
          textForAi: null,
        },
        [
          {
            index: 2,
            kind: "image",
            url: "https://storage.example/2.jpg",
            contentType: "image/jpeg",
            dispose: async () => {},
          },
        ],
      ),
    ).rejects.toMatchObject({
      code: "AI_MEDIA_INPUT_INVALID",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
