import { describe, expect, it, vi } from "vitest";
import {
  extractJsonLdRecipes,
  extractUrl,
  extractYoutubeVideoId,
} from "../../poc/url-extraction/extract.js";

describe("extractJsonLdRecipes", () => {
  it("extracts Recipe nodes nested in @graph", () => {
    const html = `
      <script type="application/ld+json">
        {"@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"親子丼","recipeYield":"2人分","totalTime":"PT20M","recipeIngredient":["鶏肉 200g"],"recipeInstructions":[{"@type":"HowToStep","text":"鶏肉を煮る"}]}]}
      </script>`;
    expect(extractJsonLdRecipes(html)).toEqual([
      {
        name: "親子丼",
        recipeYield: "2人分",
        totalTime: "PT20M",
        recipeCategory: null,
        recipeIngredient: ["鶏肉 200g"],
        recipeInstructions: ["鶏肉を煮る"],
      },
    ]);
  });

  it("ignores malformed JSON-LD and non-recipe nodes", () => {
    const html = `
      <script type="application/ld+json">not-json</script>
      <script type="application/ld+json">{"@type":"Article"}</script>`;
    expect(extractJsonLdRecipes(html)).toEqual([]);
  });
});

describe("extractYoutubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=0to72EbNg8A", "0to72EbNg8A"],
    ["https://youtu.be/0to72EbNg8A?t=10", "0to72EbNg8A"],
    ["https://www.youtube.com/shorts/0to72EbNg8A", "0to72EbNg8A"],
    ["https://www.youtube.com/embed/0to72EbNg8A", "0to72EbNg8A"],
    ["https://www.youtube.com/live/0to72EbNg8A", "0to72EbNg8A"],
  ])("extracts a video id from %s", (url, expected) => {
    expect(extractYoutubeVideoId(url)).toBe(expected);
  });

  it("rejects non-YouTube and malformed URLs", () => {
    expect(
      extractYoutubeVideoId("https://example.com/watch?v=0to72EbNg8A"),
    ).toBeNull();
    expect(extractYoutubeVideoId("not-a-url")).toBeNull();
  });
});

describe("YouTube Data API extraction", () => {
  it("uses videos.list snippet metadata instead of fetching YouTube HTML", async () => {
    const description =
      "材料 白菜 500g 豚肉 200g 調味料を混ぜて炒めます。作り方は白菜を切り、豚肉を炒め、最後に調味料を加えて全体をよく混ぜます。2人分の簡単なレシピです。";
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(url.pathname).toBe("/youtube/v3/videos");
      expect(url.searchParams.get("part")).toBe("snippet");
      expect(url.searchParams.get("id")).toBe("0to72EbNg8A");
      expect(url.searchParams.get("key")).toBe("test-youtube-key");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "0to72EbNg8A",
              snippet: {
                title: "白菜と豚肉の簡単レシピ",
                description,
                channelTitle: "Recipe Channel",
                thumbnails: {
                  high: {
                    url: "https://i.ytimg.com/vi/0to72EbNg8A/hqdefault.jpg",
                  },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await extractUrl(
      {
        id: "youtube-0to72EbNg8A",
        source: "youtube",
        url: "https://www.youtube.com/watch?v=0to72EbNg8A",
        kind: "recipe",
      },
      { youtubeApiKey: "test-youtube-key", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.http.status).toBe(200);
    expect(result.metadata.title).toBe("白菜と豚肉の簡単レシピ");
    expect(result.metadata.description).toBe(description);
    expect(result.metadata.imageUrl).toBe(
      "https://i.ytimg.com/vi/0to72EbNg8A/hqdefault.jpg",
    );
    expect(result.metadata.authorName).toBe("Recipe Channel");
    expect(result.evidence.extractionMethods).toEqual(["youtube-data-api-v3"]);
    expect(result.evidence.jsRequiredSignal).toBe(false);
    expect(result.aiInput.usable).toBe(true);
  });

  it("fails without an API key instead of falling back to YouTube page scraping", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch must not be called");
    });

    const result = await extractUrl(
      {
        id: "youtube-0to72EbNg8A",
        source: "youtube",
        url: "https://www.youtube.com/watch?v=0to72EbNg8A",
        kind: "recipe",
      },
      { youtubeApiKey: "", fetchImpl },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.aiInput.usable).toBe(false);
    expect(result.error).toBe(
      "YOUTUBE_API_KEY is required for YouTube Data API extraction",
    );
  });
});
