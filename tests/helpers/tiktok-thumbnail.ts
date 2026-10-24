import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { ProductionSourceContentExtractor } from "../../src/infrastructure/url/source-content-extractor.js";
import { AnalysisError } from "../../src/application/analysis/types.js";
import type { SafeHttpClient } from "../../src/infrastructure/url/safe-http-client.js";

export const posts = [
  {
    short: "https://vt.tiktok.com/ZSgHLdvHd/",
    author: "@tamu.recipe",
    id: "7646381901225184533",
  },
  {
    short: "https://vt.tiktok.com/ZSgH8cXso/",
    author: "@maki.recipe",
    id: "7640445938049305877",
  },
];

export function fixture(id: string, extension: string) {
  return readFileSync(
    new URL(`../fixtures/tiktok-thumbnail/${id}.${extension}`, import.meta.url),
    "utf8",
  );
}

export function setup(
  options: {
    html?: string;
    finalUrl?: string;
    thumbnail?: string;
    fail?: boolean;
    oembedId?: string;
    title?: string;
  } = {},
  post = posts[0]!,
) {
  const canonical = `https://www.tiktok.com/${post.author}/video/${post.id}`;
  const get = vi.fn<SafeHttpClient["get"]>(async (url) => {
    if (url.pathname === "/oembed") {
      return {
        finalUrl: url.toString(),
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...JSON.parse(fixture(post.id, "oembed.json")),
          ...(options.title ? { title: options.title } : {}),
          ...(options.thumbnail ? { thumbnail_url: options.thumbnail } : {}),
          ...(options.oembedId ? { embed_product_id: options.oembedId } : {}),
        }),
      };
    }
    if (options.fail)
      throw new AnalysisError("SOURCE_ACCESS_DENIED", false, "denied");
    return {
      finalUrl: options.finalUrl ?? canonical,
      statusCode: 200,
      contentType: "text/html",
      body: options.html ?? fixture(post.id, "html"),
    };
  });
  return {
    extractor: new ProductionSourceContentExtractor(
      { get } as SafeHttpClient,
      "unused",
    ),
    get,
    canonical,
  };
}
