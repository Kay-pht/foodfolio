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

const tiktokVideoSource = {
  sourceType: "tiktok" as const,
  resolvedUrl: "https://www.tiktok.com/@chef/video/123",
  imageUrl: null,
  textForAi: "TITLE\nパスタ",
};

describe("ZaiRecipeExtractor media input", () => {
  it.each([
    {
      status: 429,
      code: "AI_RATE_LIMITED",
      retryable: true,
      failureStage: "http_rate_limited",
    },
    {
      status: 503,
      code: "AI_PROVIDER_ERROR",
      retryable: true,
      failureStage: "http_provider_error",
    },
    {
      status: 400,
      code: "AI_PROVIDER_ERROR",
      retryable: false,
      failureStage: "http_rejected",
    },
  ])(
    "retains HTTP diagnostics for provider status $status",
    async ({ status, code, retryable, failureStage }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response('{"error":{"message":"provider secret detail"}}', {
              status,
              headers: { "x-request-id": "failed-request-id" },
            }),
        ),
      );
      const extractor = new ZaiRecipeExtractor("test-api-key");

      await expect(
        extractor.extractVideo(
          tiktokVideoSource,
          "https://storage.example/signed-video",
        ),
      ).rejects.toMatchObject({
        code,
        retryable,
        diagnostics: {
          aiFailureStage: failureStage,
          model: "glm-5.3-flash",
          providerRequestId: "failed-request-id",
          providerHttpStatus: status,
          latencyMs: expect.any(Number),
        },
      });
    },
  );

  it.each([
    {
      status: 429,
      code: "AI_RATE_LIMITED",
      retryable: true,
      failureStage: "http_rate_limited",
    },
    {
      status: 503,
      code: "AI_PROVIDER_ERROR",
      retryable: true,
      failureStage: "http_provider_error",
    },
    {
      status: 400,
      code: "AI_PROVIDER_ERROR",
      retryable: false,
      failureStage: "http_rejected",
    },
  ])(
    "reads provider request ID from HTTP $status JSON error envelope when the header is absent",
    async ({ status, code, retryable, failureStage }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                request_id: "body-only-request-id",
                error: { message: "provider secret detail" },
              }),
              { status },
            ),
        ),
      );
      const extractor = new ZaiRecipeExtractor("test-api-key");

      await expect(
        extractor.extractVideo(
          tiktokVideoSource,
          "https://storage.example/signed-video",
        ),
      ).rejects.toMatchObject({
        code,
        retryable,
        diagnostics: {
          aiFailureStage: failureStage,
          model: "glm-5.3-flash",
          providerRequestId: "body-only-request-id",
          providerHttpStatus: status,
          latencyMs: expect.any(Number),
        },
      });
    },
  );

  it.each([
    { errorName: "TimeoutError", failureStage: "request_timeout" },
    { errorName: "TypeError", failureStage: "request_network" },
  ])(
    "normalizes $errorName without logging its message",
    async ({ errorName, failureStage }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const error = new Error("private transport detail");
          error.name = errorName;
          throw error;
        }),
      );
      const extractor = new ZaiRecipeExtractor("test-api-key");

      await expect(
        extractor.extractVideo(
          tiktokVideoSource,
          "https://storage.example/signed-video",
        ),
      ).rejects.toMatchObject({
        code: "AI_TIMEOUT",
        retryable: true,
        diagnostics: {
          aiFailureStage: failureStage,
          model: "glm-5.3-flash",
          latencyMs: expect.any(Number),
        },
      });
    },
  );

  it("classifies a malformed provider response envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("provider response is not JSON", {
            status: 200,
            headers: { "x-request-id": "envelope-request-id" },
          }),
      ),
    );
    const extractor = new ZaiRecipeExtractor("test-api-key");

    await expect(
      extractor.extractVideo(
        tiktokVideoSource,
        "https://storage.example/signed-video",
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ANALYSIS_ERROR",
      retryable: true,
      diagnostics: {
        aiFailureStage: "response_envelope_invalid_json",
        providerRequestId: "envelope-request-id",
        providerHttpStatus: 200,
      },
    });
  });

  it.each([
    {
      name: "missing content",
      content: undefined,
      failureStage: "content_missing",
      responseContentChars: 0,
      finishReason: "stop",
      expectedFinishReason: "stop",
    },
    {
      name: "malformed JSON",
      content: "not-json",
      failureStage: "content_invalid_json",
      responseContentChars: 8,
      finishReason: "provider free-form detail",
      expectedFinishReason: "unknown",
    },
  ])(
    "retains privacy-safe diagnostics for $name",
    async ({
      content,
      failureStage,
      responseContentChars,
      finishReason,
      expectedFinishReason,
    }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                request_id: "body-request-id",
                choices: [
                  { finish_reason: finishReason, message: { content } },
                ],
                usage: { prompt_tokens: 11, completion_tokens: 22 },
              }),
              {
                status: 200,
                headers: { "x-request-id": "header-request-id" },
              },
            ),
        ),
      );
      const extractor = new ZaiRecipeExtractor("test-api-key");

      await expect(
        extractor.extractVideo(
          tiktokVideoSource,
          "https://storage.example/signed-video",
        ),
      ).rejects.toMatchObject({
        code: "AI_INVALID_JSON",
        retryable: true,
        diagnostics: {
          aiFailureStage: failureStage,
          model: "glm-5.3-flash",
          providerRequestId: "header-request-id",
          providerHttpStatus: 200,
          providerFinishReason: expectedFinishReason,
          responseContentChars,
          inputTokens: 11,
          outputTokens: 22,
          latencyMs: expect.any(Number),
        },
      });
    },
  );

  it("retains bounded schema diagnostics without response values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              request_id: "schema-request-id",
              choices: [
                {
                  finish_reason: "length",
                  message: { content: JSON.stringify({ title: "秘密の値" }) },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const extractor = new ZaiRecipeExtractor("test-api-key");

    await expect(
      extractor.extractVideo(
        tiktokVideoSource,
        "https://storage.example/signed-video",
      ),
    ).rejects.toMatchObject({
      code: "AI_SCHEMA_INVALID",
      diagnostics: {
        aiFailureStage: "schema_invalid",
        providerRequestId: "schema-request-id",
        providerFinishReason: "length",
        schemaErrorCount: expect.any(Number),
        schemaErrorKeywords: expect.arrayContaining(["required"]),
        schemaErrorPaths: expect.any(Array),
      },
    });
  });

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

  it("sends TikTok caption with the available ordered images and makes images primary", async () => {
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
        expect.objectContaining({
          type: "text",
          text: expect.stringMatching(
            /TikTok media items[\s\S]*visible media evidence as primary[\s\S]*DESCRIPTION\n肉巻きポテト #レシピ/i,
          ),
        }),
      ]);
      return successfulResponse("tiktok-photo-request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const extractor = new ZaiRecipeExtractor("test-api-key");

    await extractor.extractMedia(
      {
        sourceType: "tiktok",
        resolvedUrl: "https://www.tiktok.com/@chef/photo/12345",
        imageUrl: "https://images.example/1.jpg",
        textForAi: "DESCRIPTION\n肉巻きポテト #レシピ",
        tiktokMediaKind: "photo",
        tiktokPhotoImageUrls: ["https://images.example/1.jpg"],
      },
      [
        {
          index: 1,
          kind: "image",
          url: "https://storage.example/1.jpg",
          contentType: "image/jpeg",
          dispose: async () => {},
        },
      ],
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
