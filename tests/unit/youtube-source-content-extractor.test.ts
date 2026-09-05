import { describe, expect, it, vi } from "vitest";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";
import { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";

describe("ProductionSourceContentExtractor YouTube metadata", () => {
  it("keeps an empty description so the video fallback can decide the route", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                snippet: {
                  title: "概要だけの料理動画",
                  description: "",
                  thumbnails: {},
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
      extractor.extract(new URL("https://www.youtube.com/watch?v=0to72EbNg8A")),
    ).resolves.toMatchObject({
      sourceType: "youtube",
      resolvedUrl: "https://www.youtube.com/watch?v=0to72EbNg8A",
      textForAi: "TITLE\n概要だけの料理動画\n\nDESCRIPTION\n",
      youtubeDescription: "",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
