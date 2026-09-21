import { describe, expect, it, vi } from "vitest";
import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";

describe("ProductionSourceContentExtractor representative image resolution", () => {
  it("resolves a web OGP image without requiring recipe text", async () => {
    const http = new SafeHttpClient();
    vi.spyOn(http, "get").mockResolvedValue({
      finalUrl: "https://example.com/recipe",
      statusCode: 200,
      contentType: "text/html",
      body: '<html><head><meta property="og:image" content="/images/dish.jpg"></head><body>plain page</body></html>',
    });
    const extractor = new ProductionSourceContentExtractor(http, "youtube-key");

    await expect(
      extractor.resolveImageUrl(new URL("https://example.com/recipe")),
    ).resolves.toBe("https://example.com/images/dish.jpg");
    await expect(
      extractor.extract(new URL("https://example.com/recipe")),
    ).resolves.toEqual({
      sourceType: "web",
      resolvedUrl: "https://example.com/recipe",
      imageUrl: "https://example.com/images/dish.jpg",
      textForAi: "PAGE_TEXT\nplain page",
    });
  });

  it("uses the same YouTube thumbnail priority as initial extraction", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  title: "料理動画",
                  description: "",
                  thumbnails: {
                    high: { url: "https://img.example/high.jpg" },
                    maxres: { url: "https://img.example/maxres.jpg" },
                  },
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const extractor = new ProductionSourceContentExtractor(
      new SafeHttpClient(),
      "youtube-key",
      fetchImpl as typeof fetch,
    );

    await expect(
      extractor.resolveImageUrl(
        new URL("https://www.youtube.com/watch?v=0to72EbNg8A"),
      ),
    ).resolves.toBe("https://img.example/maxres.jpg");
  });
});
