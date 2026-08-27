import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { extractUrl } from "../../poc/url-extraction/extract.js";

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
});
