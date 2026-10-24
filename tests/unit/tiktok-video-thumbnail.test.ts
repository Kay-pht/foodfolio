import { describe, expect, it } from "vitest";
import { posts, fixture, setup } from "../helpers/tiktok-thumbnail.js";

describe("TikTok video thumbnail fallback (TVT-1, TVT-3)", () => {
  it.each(posts)(
    "recovers the missing oEmbed thumbnail for $id",
    async (post) => {
      const { extractor, get } = setup({}, post);
      const source = await extractor.extract(new URL(post.short));
      expect(source.imageUrl).toBe(`https://images.example/${post.id}.jpg`);
      expect(source.textForAi).toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
      await expect(
        extractor.resolveImageUrl(new URL(post.short)),
      ).resolves.toBe(source.imageUrl);
    },
  );

  it("keeps oEmbed thumbnails without fetching the page", async () => {
    const { extractor, get } = setup({
      thumbnail: "https://images.example/oembed.jpg",
    });
    expect((await extractor.extract(new URL(posts[0]!.short))).imageUrl).toBe(
      "https://images.example/oembed.jpg",
    );
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([
    "https://vm.tiktok.com/example/",
    "https://www.tiktok.com/@tamu.recipe/video/7646381901225184533",
  ])("supports %s", async (url) => {
    const { extractor } = setup();
    expect((await extractor.extract(new URL(url))).imageUrl).toBe(
      "https://images.example/7646381901225184533.jpg",
    );
  });

  it("uses originCover when cover is absent or unsafe", async () => {
    const html = fixture(posts[0]!.id, "html").replace(
      "https://images.example/7646381901225184533.jpg",
      "javascript:alert(1)",
    );
    const { extractor } = setup({ html });
    expect((await extractor.extract(new URL(posts[0]!.short))).imageUrl).toBe(
      "https://images.example/7646381901225184533-origin.jpg",
    );
  });

  it.each([
    { fail: true },
    { html: "<html>challenge</html>" },
    {
      html: '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">invalid json</script>',
    },
    { html: fixture(posts[1]!.id, "html") },
    { html: fixture(posts[0]!.id, "html").replaceAll("https:", "http:") },
    { html: fixture(posts[0]!.id, "html").replace('"video"', '"notVideo"') },
    { finalUrl: "https://example.com/@tamu.recipe/video/7646381901225184533" },
    {
      finalUrl: "https://www.tiktok.com/@tamu.recipe/photo/7646381901225184533",
    },
    {
      finalUrl: "https://www.tiktok.com/@tamu.recipe/video/7640445938049305877",
    },
    { oembedId: "7640445938049305877" },
  ])(
    "preserves metadata when optional cover recovery is unavailable: %j",
    async (options) => {
      const { extractor } = setup({ ...options, title: "料理動画" });
      await expect(
        extractor.extract(new URL(posts[0]!.short)),
      ).resolves.toMatchObject({
        imageUrl: null,
        textForAi: "TITLE\n料理動画",
      });
    },
  );
});
