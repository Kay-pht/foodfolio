import { describe, expect, it, vi } from "vitest";
import type { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";

describe("ProductionSourceContentExtractor TikTok metadata", () => {
  it("resolves a TikTok Lite short URL before calling oEmbed", async () => {
    const shortUrl = "https://lite.tiktok.com/t/ZSbrNjCU1/";
    const canonicalUrl =
      "https://www.tiktok.com/@3papa_recipe/video/7689369774719094024";
    const get = vi.fn<SafeHttpClient["get"]>(async (input) => {
      const requestedUrl = input.toString();
      if (requestedUrl === shortUrl) {
        return {
          finalUrl: canonicalUrl,
          statusCode: 200,
          contentType: "text/html",
          body: "<html></html>",
        };
      }

      const endpoint = new URL(requestedUrl);
      expect(endpoint.origin).toBe("https://www.tiktok.com");
      expect(endpoint.pathname).toBe("/oembed");
      expect(endpoint.searchParams.get("url")).toBe(canonicalUrl);
      return {
        finalUrl: requestedUrl,
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "10分で作れる簡単レシピ",
          thumbnail_url: "https://images.example/tiktok.jpg",
        }),
      };
    });
    const extractor = new ProductionSourceContentExtractor(
      { get } as SafeHttpClient,
      "unused",
    );

    await expect(extractor.extract(new URL(shortUrl))).resolves.toEqual({
      sourceType: "tiktok",
      resolvedUrl: canonicalUrl,
      imageUrl: "https://images.example/tiktok.jpg",
      textForAi: "TITLE\n10分で作れる簡単レシピ",
      tiktokMediaKind: "video",
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]?.[1]).toBe("tiktok_short_url");
    expect(get.mock.calls[1]?.[1]).toBe("tiktok_oembed");
  });

  it("keeps canonical TikTok video URLs on the direct oEmbed path", async () => {
    const canonicalUrl =
      "https://www.tiktok.com/@chef/video/7689369774719094024";
    const get = vi.fn<SafeHttpClient["get"]>(async (input) => {
      const endpoint = new URL(input.toString());
      expect(endpoint.origin).toBe("https://www.tiktok.com");
      expect(endpoint.pathname).toBe("/oembed");
      expect(endpoint.searchParams.get("url")).toBe(canonicalUrl);
      return {
        finalUrl: endpoint.toString(),
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: "料理動画" }),
      };
    });
    const extractor = new ProductionSourceContentExtractor(
      { get } as SafeHttpClient,
      "unused",
    );

    await expect(
      extractor.extract(new URL(canonicalUrl)),
    ).resolves.toMatchObject({
      sourceType: "tiktok",
      resolvedUrl: canonicalUrl,
      textForAi: "TITLE\n料理動画",
      tiktokMediaKind: "video",
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[1]).toBe("tiktok_oembed");
  });

  it("rejects a TikTok Lite short URL that does not resolve to a TikTok post", async () => {
    const get = vi.fn<SafeHttpClient["get"]>(async () => ({
      finalUrl: "https://example.com/not-a-tiktok-post",
      statusCode: 200,
      contentType: "text/html",
      body: "<html></html>",
    }));
    const extractor = new ProductionSourceContentExtractor(
      { get } as SafeHttpClient,
      "unused",
    );

    await expect(
      extractor.extract(new URL("https://lite.tiktok.com/t/not-a-post/")),
    ).rejects.toMatchObject({
      code: "SOURCE_CONTENT_UNAVAILABLE",
      retryable: false,
    });
    expect(get).toHaveBeenCalledOnce();
  });
});
