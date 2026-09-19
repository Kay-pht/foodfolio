import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type {
  SourceName,
  UrlCase,
} from "../url-extraction/types.js";

const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_DISCOVERY_PAGES_PER_SITE = 80;
const MAX_DISCOVERED_CASES_PER_KIND = 2_000;
const USER_AGENT =
  "foodfolio-poc/1.0 (+https://github.com/Kay-pht/foodfolio; recipe-gate-validation)";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type NegativeTier = "hard" | "easy";

export interface DiscoveredCase extends UrlCase {
  discoverySite: string;
  negativeTier: NegativeTier | null;
}

interface SiteDefinition {
  id: string;
  source: SourceName;
  origin: string;
  seeds: string[];
  isRecipePath(pathname: string): boolean;
}

const RECIPE_ADJACENT_PATH =
  /(recipe|homecook|cook|cooking|food|menu|ingredient|lists?|articles?|search|categor|tags?|theme|series|kitchen|kondate)/i;

const SITE_DEFINITIONS: SiteDefinition[] = [
  {
    id: "kikkoman",
    source: "general-web",
    origin: "https://www.kikkoman.co.jp",
    seeds: [
      "https://www.kikkoman.co.jp/homecook/",
      "https://www.kikkoman.co.jp/homecook/search/",
      "https://www.kikkoman.co.jp/homecook/series/",
      "https://www.kikkoman.co.jp/homecook/theme/",
    ],
    isRecipePath: (pathname) =>
      /^\/homecook\/search\/recipe\/\d+\/?$/u.test(pathname),
  },
  {
    id: "sirogohan",
    source: "general-web",
    origin: "https://www.sirogohan.com",
    seeds: [
      "https://www.sirogohan.com/",
      "https://www.sirogohan.com/recipe/",
    ],
    isRecipePath: (pathname) =>
      /^\/recipe\/[^/]+\/?$/u.test(pathname) &&
      pathname !== "/recipe/",
  },
  {
    id: "ajinomoto",
    source: "general-web",
    origin: "https://park.ajinomoto.co.jp",
    seeds: [
      "https://park.ajinomoto.co.jp/recipe/",
      "https://park.ajinomoto.co.jp/",
    ],
    isRecipePath: (pathname) =>
      /^\/recipe\/card\/\d+\/?$/u.test(pathname),
  },
  {
    id: "kurashiru",
    source: "kurashiru",
    origin: "https://www.kurashiru.com",
    seeds: [
      "https://www.kurashiru.com/",
      "https://www.kurashiru.com/recipes",
      "https://www.kurashiru.com/lists",
      "https://www.kurashiru.com/articles",
    ],
    isRecipePath: (pathname) =>
      /^\/(?:recipes|recipe_cards)\/[0-9a-f-]+\/?$/iu.test(pathname),
  },
  {
    id: "cookpad",
    source: "cookpad",
    origin: "https://cookpad.com",
    seeds: ["https://cookpad.com/jp", "https://cookpad.com/jp/search"],
    isRecipePath: (pathname) =>
      /^\/jp\/recipes\/\d+\/?$/u.test(pathname),
  },
];

const CURATED_CASES: DiscoveredCase[] = [
  {
    id: "curated-kikkoman-00050326",
    source: "general-web",
    url: "https://www.kikkoman.co.jp/homecook/search/recipe/00050326/",
    kind: "recipe",
    discoverySite: "kikkoman",
    negativeTier: null,
  },
  {
    id: "curated-sirogohan-garibata",
    source: "general-web",
    url: "https://www.sirogohan.com/recipe/garibata/",
    kind: "recipe",
    discoverySite: "sirogohan",
    negativeTier: null,
  },
  {
    id: "curated-ajinomoto-802533",
    source: "general-web",
    url: "https://park.ajinomoto.co.jp/recipe/card/802533/",
    kind: "recipe",
    discoverySite: "ajinomoto",
    negativeTier: null,
  },
  {
    id: "curated-kurashiru-a3b1f093",
    source: "kurashiru",
    url: "https://www.kurashiru.com/recipes/a3b1f093-1f5e-4114-8cc8-8869e8e6871d",
    kind: "recipe",
    discoverySite: "kurashiru",
    negativeTier: null,
  },
  {
    id: "curated-cookpad-21712598",
    source: "cookpad",
    url: "https://cookpad.com/jp/recipes/21712598",
    kind: "recipe",
    discoverySite: "cookpad",
    negativeTier: null,
  },
  {
    id: "curated-example",
    source: "general-web",
    url: "https://example.com/",
    kind: "non-recipe",
    discoverySite: "external-control",
    negativeTier: "easy",
  },
  {
    id: "curated-kikkoman-homecook",
    source: "general-web",
    url: "https://www.kikkoman.co.jp/homecook/",
    kind: "non-recipe",
    discoverySite: "kikkoman",
    negativeTier: "hard",
  },
  {
    id: "curated-ajinomoto-recipe-index",
    source: "general-web",
    url: "https://park.ajinomoto.co.jp/recipe/",
    kind: "non-recipe",
    discoverySite: "ajinomoto",
    negativeTier: "hard",
  },
  {
    id: "curated-kurashiru-home",
    source: "kurashiru",
    url: "https://www.kurashiru.com/",
    kind: "non-recipe",
    discoverySite: "kurashiru",
    negativeTier: "hard",
  },
  {
    id: "curated-cookpad-home",
    source: "cookpad",
    url: "https://cookpad.com/jp",
    kind: "non-recipe",
    discoverySite: "cookpad",
    negativeTier: "hard",
  },
];

function normalizedUrl(value: string, base: string): URL | null {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.startsWith("utm_") ||
      key === "gclid" ||
      key === "fbclid" ||
      key === "ref"
    ) {
      url.searchParams.delete(key);
    }
  }
  if (
    /\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webp|xml|zip)$/iu.test(
      url.pathname,
    )
  ) {
    return null;
  }
  return url;
}

function stableRank(url: string): string {
  return createHash("sha256")
    .update(`jev-recipe-gate-v2:${url}`)
    .digest("hex");
}

function caseId(site: SiteDefinition, url: URL): string {
  const digest = createHash("sha256").update(url.href).digest("hex").slice(0, 12);
  return `discovered-${site.id}-${digest}`;
}

export function isKnownRecipeUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const site = SITE_DEFINITIONS.find(({ origin }) => origin === url.origin);
  return site?.isRecipePath(url.pathname) ?? false;
}

function classifyUrl(
  site: SiteDefinition,
  url: URL,
): DiscoveredCase | null {
  if (url.origin !== site.origin) return null;
  if (site.isRecipePath(url.pathname)) {
    return {
      id: caseId(site, url),
      source: site.source,
      url: url.href,
      kind: "recipe",
      discoverySite: site.id,
      negativeTier: null,
    };
  }

  const negativeTier: NegativeTier = RECIPE_ADJACENT_PATH.test(url.pathname)
    ? "hard"
    : "easy";
  return {
    id: caseId(site, url),
    source: site.source,
    url: url.href,
    kind: "non-recipe",
    discoverySite: site.id,
    negativeTier,
  };
}

function shouldCrawl(site: SiteDefinition, url: URL): boolean {
  if (url.origin !== site.origin) return false;
  if (site.isRecipePath(url.pathname)) return false;
  if (url.search.length > 120) return false;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length > 6) return false;
  return true;
}

async function fetchLinks(
  url: string,
  fetchImpl: FetchLike,
): Promise<string[]> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return [];
    const html = await response.text();
    const $ = cheerio.load(html);
    const links = new Set<string>();
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      const parsed = normalizedUrl(href, response.url || url);
      if (parsed) links.add(parsed.href);
    });
    return [...links];
  } catch {
    return [];
  }
}

async function discoverSite(
  site: SiteDefinition,
  fetchImpl: FetchLike,
): Promise<DiscoveredCase[]> {
  const queue = [...site.seeds];
  const queued = new Set(queue);
  const crawled = new Set<string>();
  const cases = new Map<string, DiscoveredCase>();

  while (
    queue.length > 0 &&
    crawled.size < MAX_DISCOVERY_PAGES_PER_SITE &&
    cases.size < MAX_DISCOVERED_CASES_PER_KIND * 2
  ) {
    const pageUrl = queue.shift();
    if (!pageUrl || crawled.has(pageUrl)) continue;
    crawled.add(pageUrl);

    const page = normalizedUrl(pageUrl, site.origin);
    if (page) {
      const pageCase = classifyUrl(site, page);
      if (pageCase) cases.set(pageCase.url, pageCase);
    }

    const links = await fetchLinks(pageUrl, fetchImpl);
    for (const href of links) {
      const parsed = normalizedUrl(href, site.origin);
      if (!parsed || parsed.origin !== site.origin) continue;
      const candidate = classifyUrl(site, parsed);
      if (candidate) cases.set(candidate.url, candidate);
      if (
        shouldCrawl(site, parsed) &&
        !queued.has(parsed.href) &&
        crawled.size + queue.length < MAX_DISCOVERY_PAGES_PER_SITE * 2
      ) {
        queued.add(parsed.href);
        queue.push(parsed.href);
      }
    }
  }

  return [...cases.values()];
}

function deduplicate(
  cases: DiscoveredCase[],
): DiscoveredCase[] {
  const byUrl = new Map<string, DiscoveredCase>();
  for (const item of cases) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

function interleaveBySite(
  cases: DiscoveredCase[],
): DiscoveredCase[] {
  const buckets = new Map<string, DiscoveredCase[]>();
  for (const item of cases) {
    const bucket = buckets.get(item.discoverySite) ?? [];
    bucket.push(item);
    buckets.set(item.discoverySite, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      stableRank(left.url).localeCompare(stableRank(right.url)),
    );
  }

  const ordered: DiscoveredCase[] = [];
  const siteNames = [...buckets.keys()].sort();
  let added = true;
  while (added) {
    added = false;
    for (const siteName of siteNames) {
      const item = buckets.get(siteName)?.shift();
      if (!item) continue;
      ordered.push(item);
      added = true;
    }
  }
  return ordered;
}

export async function discoverJevGateCases(
  fetchImpl: FetchLike = fetch,
): Promise<{
  recipe: DiscoveredCase[];
  hardNegative: DiscoveredCase[];
  easyNegative: DiscoveredCase[];
}> {
  const discovered: DiscoveredCase[] = [...CURATED_CASES];

  for (const site of SITE_DEFINITIONS) {
    discovered.push(...(await discoverSite(site, fetchImpl)));
  }

  const unique = deduplicate(discovered);
  return {
    recipe: interleaveBySite(
      unique.filter(({ kind }) => kind === "recipe"),
    ).slice(0, MAX_DISCOVERED_CASES_PER_KIND),
    hardNegative: interleaveBySite(
      unique.filter(
        ({ kind, negativeTier }) =>
          kind === "non-recipe" && negativeTier === "hard",
      ),
    ).slice(0, MAX_DISCOVERED_CASES_PER_KIND),
    easyNegative: interleaveBySite(
      unique.filter(
        ({ kind, negativeTier }) =>
          kind === "non-recipe" && negativeTier === "easy",
      ),
    ).slice(0, MAX_DISCOVERED_CASES_PER_KIND),
  };
}
