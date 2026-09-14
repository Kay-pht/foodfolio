import { describe, expect, it, vi } from "vitest";
import { AnalysisError } from "../../src/application/analysis/types.js";
import type {
  RepresentativeImageResolver,
  SourceContent,
  SourceContentExtractor,
} from "../../src/application/analysis/types.js";
import type { SharedConversationAdapter } from "../../src/infrastructure/url/ai-shared-conversation.js";
import { AiAwareSourceContentExtractor } from "../../src/infrastructure/url/ai-aware-source-content-extractor.js";

function fallbackExtractor() {
  const extract = vi.fn(async (url: URL): Promise<SourceContent> => ({
    sourceType: "web",
    resolvedUrl: url.toString(),
    imageUrl: "https://example.com/image.jpg",
    textForAi: "generic web evidence",
  }));
  const resolveImageUrl = vi.fn(async () => "https://example.com/image.jpg");
  return {
    extractor: { extract, resolveImageUrl } satisfies SourceContentExtractor &
      RepresentativeImageResolver,
    extract,
    resolveImageUrl,
  };
}

function adapter(resolvedUrl: string, text: string): SharedConversationAdapter {
  return {
    extract: vi.fn(async () => ({
      resolvedUrl,
      messages: [
        { role: "user" as const, text: "最初の依頼" },
        { role: "assistant" as const, text },
        { role: "user" as const, text: "塩は半量に変更して" },
      ],
    })),
  };
}

describe("AiAwareSourceContentExtractor", () => {
  it("routes ChatGPT shares through the dedicated adapter without generic fallback", async () => {
    const fallback = fallbackExtractor();
    const chatgpt = adapter(
      "https://chatgpt.com/share/example",
      "塩は小さじ1です",
    );
    const gemini = adapter(
      "https://gemini.google.com/share/example",
      "使わない",
    );
    const extractor = new AiAwareSourceContentExtractor(
      fallback.extractor,
      chatgpt,
      gemini,
    );

    const result = await extractor.extract(
      new URL("https://chatgpt.com/share/example"),
    );

    expect(result).toMatchObject({
      sourceType: "chatgpt",
      resolvedUrl: "https://chatgpt.com/share/example",
      imageUrl: null,
    });
    expect(result.textForAi).toContain("MESSAGE 1 ROLE=user\n最初の依頼");
    expect(result.textForAi).toContain(
      "MESSAGE 3 ROLE=user\n塩は半量に変更して",
    );
    expect(fallback.extract).not.toHaveBeenCalled();
    await expect(
      extractor.resolveImageUrl(new URL("https://chatgpt.com/share/example")),
    ).resolves.toBeNull();
    expect(fallback.resolveImageUrl).not.toHaveBeenCalled();
  });

  it("propagates provider format failures instead of falling back to generic web", async () => {
    const fallback = fallbackExtractor();
    const formatError = new AnalysisError(
      "SHARED_CONVERSATION_FORMAT_CHANGED",
      false,
      "provider payload changed",
    );
    const chatgpt: SharedConversationAdapter = {
      extract: vi.fn(async () => {
        throw formatError;
      }),
    };
    const extractor = new AiAwareSourceContentExtractor(
      fallback.extractor,
      chatgpt,
      adapter("https://gemini.google.com/share/example", "unused"),
    );

    await expect(
      extractor.extract(new URL("https://chatgpt.com/share/example")),
    ).rejects.toBe(formatError);
    expect(fallback.extract).not.toHaveBeenCalled();
  });

  it("keeps existing generic URLs on the original extraction path", async () => {
    const fallback = fallbackExtractor();
    const extractor = new AiAwareSourceContentExtractor(
      fallback.extractor,
      adapter("https://chatgpt.com/share/example", "unused"),
      adapter("https://gemini.google.com/share/example", "unused"),
    );
    const url = new URL("https://example.com/recipe");

    await expect(extractor.extract(url)).resolves.toMatchObject({
      sourceType: "web",
      resolvedUrl: "https://example.com/recipe",
    });
    expect(fallback.extract).toHaveBeenCalledWith(url);
  });
});
