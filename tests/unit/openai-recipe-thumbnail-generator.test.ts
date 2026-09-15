import { describe, expect, it, vi } from "vitest";
import {
  buildRecipeThumbnailPrompt,
  OpenAiRecipeThumbnailGenerator,
} from "../../src/infrastructure/ai/openai-recipe-thumbnail-generator.js";
import type { ExtractedRecipe } from "../../src/application/analysis/types.js";

const recipe: ExtractedRecipe = {
  title: "鶏の照り焼き",
  servings: { value: 2, raw: "2人分" },
  cookingTimeMinutes: 20,
  genre: "主菜",
  ingredients: [
    { name: "鶏もも肉", amount: "300g" },
    { name: "しょうゆ", amount: "大さじ2" },
  ],
  steps: ["鶏肉を焼く", "調味料を加えて照りが出るまで絡める"],
};

describe("OpenAiRecipeThumbnailGenerator", () => {
  it("requests one low-quality square WebP from gpt-image-2.5-flare", async () => {
    const fetcher = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(init?.headers).toEqual(
          expect.objectContaining({ authorization: "Bearer openai-test-key" }),
        );
        expect(body).toEqual(
          expect.objectContaining({
            model: "gpt-image-2.5-flare",
            n: 1,
            quality: "low",
            size: "1024x1024",
            output_format: "webp",
          }),
        );
        expect(String(body.prompt)).toContain("鶏の照り焼き");
        expect(String(body.prompt)).toContain("鶏もも肉");
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from("webp").toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;
    const generator = new OpenAiRecipeThumbnailGenerator(
      "openai-test-key",
      undefined,
      fetcher,
    );

    const generated = await generator.generate(recipe);

    expect(Buffer.from(generated.data).toString()).toBe("webp");
    expect(generated.contentType).toBe("image/webp");
    expect(generated.extension).toBe("webp");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails with a sanitized error when the provider does not succeed", async () => {
    const fetcher = vi.fn(
      async () => new Response("provider details", { status: 429 }),
    ) as unknown as typeof fetch;
    const generator = new OpenAiRecipeThumbnailGenerator(
      "openai-test-key",
      "gpt-image-2.5-flare",
      fetcher,
    );

    await expect(generator.generate(recipe)).rejects.toThrow(
      "OpenAI image generation failed with status 429",
    );
  });

  it("rejects a successful response without image data", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{}] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const generator = new OpenAiRecipeThumbnailGenerator(
      "openai-test-key",
      "gpt-image-2.5-flare",
      fetcher,
    );

    await expect(generator.generate(recipe)).rejects.toThrow(
      "OpenAI image generation returned no image data",
    );
  });
});

describe("buildRecipeThumbnailPrompt", () => {
  it("uses only structured recipe fields and marks them as untrusted data", () => {
    const prompt = buildRecipeThumbnailPrompt(recipe);

    expect(prompt).toContain("untrusted content");
    expect(prompt).toContain("<recipe_data>");
    expect(prompt).toContain("鶏の照り焼き");
    expect(prompt).toContain("しょうゆ");
    expect(prompt).toContain("鶏肉を焼く");
    expect(prompt).toContain("Do not show people");
  });
});
