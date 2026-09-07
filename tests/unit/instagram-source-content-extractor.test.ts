import { describe, expect, it } from "vitest";
import type { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";

describe("Instagram source metadata extraction", () => {
  it("returns empty text instead of failing so video fallback can run", async () => {
    const http = {
      async get() {
        return {
          finalUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
          statusCode: 200,
          contentType: "text/html",
          body: `<!doctype html><html><head>
            <meta property="og:title" content="今日の晩ごはん">
            <meta property="og:image" content="https://images.example/cover.jpg">
          </head><body>おいしくできました</body></html>`,
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    await expect(
      extractor.extract(new URL("https://www.instagram.com/reel/Chunk8-jurw/")),
    ).resolves.toEqual({
      sourceType: "instagram",
      resolvedUrl: "https://www.instagram.com/reel/Chunk8-jurw/",
      imageUrl: "https://images.example/cover.jpg",
      textForAi: null,
    });
  });

  it("keeps recipe-bearing Instagram metadata for the text-first path", async () => {
    const http = {
      async get() {
        return {
          finalUrl: "https://www.instagram.com/p/aye83DjauH/",
          statusCode: 200,
          contentType: "text/html",
          body: `<!doctype html><html><head>
            <meta property="og:title" content="パスタ">
            <meta property="og:description" content="材料 パスタ100g。作り方 茹でる。">
          </head><body></body></html>`,
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    const result = await extractor.extract(
      new URL("https://www.instagram.com/p/aye83DjauH/"),
    );

    expect(result.sourceType).toBe("instagram");
    expect(result.textForAi).toContain("材料 パスタ100g。作り方 茹でる。");
  });
});
