import { describe, expect, it } from "vitest";
import type { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";

describe("HTML source metadata extraction", () => {
  it("keeps non-keyword Instagram metadata so Jev can classify it", async () => {
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

    const result = await extractor.extract(
      new URL("https://www.instagram.com/reel/Chunk8-jurw/"),
    );

    expect(result.sourceType).toBe("instagram");
    expect(result.imageUrl).toBe("https://images.example/cover.jpg");
    expect(result.textForAi).toContain("今日の晩ごはん");
    expect(result.textForAi).toContain("おいしくできました");
  });

  it("keeps recipe-bearing Instagram metadata for Jev classification", async () => {
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

  it("keeps meaningful general Web text even without recipe keywords", async () => {
    const http = {
      async get() {
        return {
          finalUrl: "https://example.com/story",
          statusCode: 200,
          contentType: "text/html",
          body: `<!doctype html><html><head>
            <title>秋の食卓について</title>
          </head><body>旬の食材と家族の思い出を紹介します。</body></html>`,
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    const result = await extractor.extract(new URL("https://example.com/story"));

    expect(result.sourceType).toBe("web");
    expect(result.textForAi).toContain("秋の食卓について");
    expect(result.textForAi).toContain("旬の食材と家族の思い出を紹介します。");
  });
});
