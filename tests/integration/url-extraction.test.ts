import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractUrl } from "../../poc/url-extraction/extract.js";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";
import type { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("extractUrl integration", () => {
  it("fetches HTML and builds a usable AI input from JSON-LD", async () => {
    const server = createServer((_, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head>
        <meta property="og:title" content="テストカレー">
        <meta property="og:image" content="https://example.test/curry.jpg">
        <script type="application/ld+json">{"@type":"Recipe","name":"テストカレー","recipeIngredient":["玉ねぎ 1個"],"recipeInstructions":["炒める"]}</script>
      </head><body>材料と作り方</body></html>`);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing port");

    const result = await extractUrl({
      id: "local",
      source: "general-web",
      url: `http://127.0.0.1:${address.port}/recipe`,
      kind: "recipe",
    });

    expect(result.http.status).toBe(200);
    expect(result.metadata.title).toBe("テストカレー");
    expect(result.metadata.imageUrl).toBe("https://example.test/curry.jpg");
    expect(result.jsonLdRecipes).toHaveLength(1);
    expect(result.aiInput.usable).toBe(true);
  });

  it("builds TikTok recipe input from public oEmbed metadata", async () => {
    const http = {
      async get(url: URL) {
        expect(url.origin + url.pathname).toBe("https://www.tiktok.com/oembed");
        expect(url.searchParams.get("url")).toBe(
          "https://www.tiktok.com/@chef/video/123",
        );
        return {
          finalUrl: url.toString(),
          statusCode: 200,
          contentType: "application/json",
          body: JSON.stringify({
            title: "材料 豚肉 200g 作り方 焼く",
            thumbnail_url: "https://images.example/tiktok.jpg",
          }),
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    await expect(
      extractor.extract(new URL("https://www.tiktok.com/@chef/video/123")),
    ).resolves.toEqual({
      sourceType: "tiktok",
      resolvedUrl: "https://www.tiktok.com/@chef/video/123",
      imageUrl: "https://images.example/tiktok.jpg",
      textForAi: "TITLE\n材料 豚肉 200g 作り方 焼く",
    });
  });

  it("does not contact TikTok photo metadata when media analysis is disabled", async () => {
    const get = vi.fn();
    const extractor = new ProductionSourceContentExtractor(
      { get } as unknown as SafeHttpClient,
      "unused",
    );
    const photoUrl = new URL("https://www.tiktok.com/@chef/photo/12345");

    await expect(extractor.extract(photoUrl)).rejects.toMatchObject({
      code: "TIKTOK_MEDIA_ANALYSIS_DISABLED",
      retryable: false,
    });
    await expect(extractor.resolveImageUrl(photoUrl)).rejects.toMatchObject({
      code: "TIKTOK_MEDIA_ANALYSIS_DISABLED",
      retryable: false,
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("routes TikTok photo posts to ordered public image metadata without oEmbed", async () => {
    const imageUrls = Array.from(
      { length: 12 },
      (_, index) => `https://images.example/photo-${index + 1}.jpg`,
    );
    const http = {
      async get(url: URL) {
        expect(url.origin + url.pathname).toBe(
          "https://www.tiktok.com/player/api/v1/items",
        );
        expect(url.searchParams.get("item_ids")).toBe("7526427403409689874");
        return {
          finalUrl: url.toString(),
          statusCode: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status_code: 0,
            items: [
              {
                id_str: "7526427403409689874",
                desc: "肉巻きポテト #レシピ #簡単",
                image_post_info: {
                  images: imageUrls.map((imageUrl) => ({
                    display_image: { url_list: [imageUrl] },
                  })),
                },
              },
            ],
          }),
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(
      http,
      "unused",
      fetch,
      true,
    );

    const photoUrl = new URL(
      "https://www.tiktok.com/@ma___na_18/photo/7526427403409689874?_r=1&_t=share",
    );
    await expect(extractor.extract(photoUrl)).resolves.toEqual({
      sourceType: "tiktok",
      resolvedUrl:
        "https://www.tiktok.com/@ma___na_18/photo/7526427403409689874",
      imageUrl: imageUrls[0],
      textForAi: "DESCRIPTION\n肉巻きポテト #レシピ #簡単",
      tiktokMediaKind: "photo",
      tiktokPhotoImageUrls: imageUrls.slice(0, 10),
    });
    await expect(extractor.resolveImageUrl(photoUrl)).resolves.toBe(
      imageUrls[0],
    );
  });

  it.each([
    "#レシピ #簡単 #息子の夜食 #ペペロンチーノ",
    "分量はキャプションを確認してください",
    "下ごしらえを紹介します",
    "下準備のポイント",
    "作りかたを紹介します",
    "つくり方を紹介します",
    "つくりかたを紹介します",
  ])(
    "accepts Japanese recipe wording in TikTok metadata: %s",
    async (title) => {
      const http = {
        async get() {
          return {
            finalUrl: "https://www.tiktok.com/oembed",
            statusCode: 200,
            contentType: "application/json",
            body: JSON.stringify({ title }),
          };
        },
      } as SafeHttpClient;
      const extractor = new ProductionSourceContentExtractor(http, "unused");

      await expect(
        extractor.extract(new URL("https://www.tiktok.com/@chef/video/123")),
      ).resolves.toMatchObject({ textForAi: `TITLE\n${title}` });
    },
  );

  it("keeps a generic TikTok title so completeness can be decided after AI extraction", async () => {
    const http = {
      async get() {
        return {
          finalUrl: "https://www.tiktok.com/oembed",
          statusCode: 200,
          contentType: "application/json",
          body: JSON.stringify({ title: "簡単な料理を食べてみた" }),
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    await expect(
      extractor.extract(new URL("https://www.tiktok.com/@chef/video/123")),
    ).resolves.toMatchObject({
      sourceType: "tiktok",
      textForAi: "TITLE\n簡単な料理を食べてみた",
    });
  });

  it("returns empty TikTok text so the analysis service can use video fallback", async () => {
    const http = {
      async get() {
        return {
          finalUrl: "https://www.tiktok.com/oembed",
          statusCode: 200,
          contentType: "application/json",
          body: JSON.stringify({
            thumbnail_url: "https://images.example/tiktok.jpg",
          }),
        };
      },
    } as SafeHttpClient;
    const extractor = new ProductionSourceContentExtractor(http, "unused");

    await expect(
      extractor.extract(new URL("https://www.tiktok.com/@chef/video/123")),
    ).resolves.toMatchObject({ sourceType: "tiktok", textForAi: null });
  });
});
