import { describe, expect, it } from "vitest";
import {
  extractJsonLdRecipes,
  extractYoutubeDescription,
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

describe("extractYoutubeDescription", () => {
  it("extracts the complete video description from player JSON", () => {
    const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"材料\\n白菜 500g"}};</script>`;
    expect(extractYoutubeDescription(html)).toBe("材料 白菜 500g");
  });

  it("handles braces embedded in JSON strings", () => {
    const html = `<script>var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"材料 {2人分}"}};</script>`;
    expect(extractYoutubeDescription(html)).toBe("材料 {2人分}");
  });
});
