export type ExpectedInstagramCase =
  | "reel"
  | "video"
  | "image"
  | "image-carousel"
  | "video-carousel"
  | "mixed-carousel";

export interface PocCase {
  id: string;
  expectedKind: ExpectedInstagramCase;
  url: string;
  source?: string;
}

export interface MediaAsset {
  index: number;
  kind: "image" | "video";
  url: string;
  width: number | null;
  height: number | null;
  httpHeaders: Record<string, string>;
}

export interface ParsedInstagramMedia {
  caption: string | null;
  assets: MediaAsset[];
  unavailableEntryCount: number;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function dimensionsScore(value: UnknownRecord): number {
  return (asNumber(value.width) ?? 0) * (asNumber(value.height) ?? 0);
}

function pickBestRecord(
  values: unknown,
  preferCombinedVideo = false,
): UnknownRecord | null {
  if (!Array.isArray(values)) return null;
  const candidates = values
    .map(asRecord)
    .filter((value): value is UnknownRecord => value !== null)
    .filter((value) => asString(value.url) !== null);
  const preferred = preferCombinedVideo
    ? candidates.filter(
        (value) => value.acodec !== "none" && value.vcodec !== "none",
      )
    : candidates;
  return (
    (preferred.length ? preferred : candidates).sort(
      (a, b) => dimensionsScore(b) - dimensionsScore(a),
    )[0] ?? null
  );
}

function headersFrom(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function mediaAssetFromEntry(
  entry: UnknownRecord,
  index: number,
): MediaAsset | null {
  const format = pickBestRecord(entry.formats, true);
  if (format) {
    return {
      index,
      kind: "video",
      url: asString(format.url)!,
      width: asNumber(format.width),
      height: asNumber(format.height),
      httpHeaders: {
        ...headersFrom(entry.http_headers),
        ...headersFrom(format.http_headers),
      },
    };
  }

  const thumbnail = pickBestRecord(entry.thumbnails);
  if (!thumbnail) return null;
  return {
    index,
    kind: "image",
    url: asString(thumbnail.url)!,
    width: asNumber(thumbnail.width),
    height: asNumber(thumbnail.height),
    httpHeaders: headersFrom(entry.http_headers),
  };
}

function candidateEntries(root: UnknownRecord): Array<UnknownRecord | null> {
  if (!Array.isArray(root.entries)) return [root];
  return root.entries.map((entry) => asRecord(entry));
}

export function parseYtDlpInstagramJson(value: unknown): ParsedInstagramMedia {
  const root = asRecord(value);
  if (!root) throw new Error("yt-dlp output must be a JSON object");

  const entries = candidateEntries(root);
  const assets: MediaAsset[] = [];
  let unavailableEntryCount = 0;
  for (const [offset, entry] of entries.entries()) {
    if (!entry) {
      unavailableEntryCount += 1;
      continue;
    }
    const asset = mediaAssetFromEntry(entry, offset + 1);
    if (asset) assets.push(asset);
    else unavailableEntryCount += 1;
  }

  return {
    caption: asString(root.description),
    assets,
    unavailableEntryCount,
  };
}

export function classifyInstagramMedia(
  url: string,
  parsed: ParsedInstagramMedia,
): ExpectedInstagramCase | "unknown" {
  if (parsed.assets.length === 0 || parsed.unavailableEntryCount > 0)
    return "unknown";
  const kinds = parsed.assets.map((asset) => asset.kind);
  const allImages = kinds.every((kind) => kind === "image");
  const allVideos = kinds.every((kind) => kind === "video");
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const isReel = path.includes("reel") || path.includes("reels");

  if (isReel && parsed.assets.length === 1 && allVideos) return "reel";
  if (parsed.assets.length === 1) return allVideos ? "video" : "image";
  if (allImages) return "image-carousel";
  if (allVideos) return "video-carousel";
  return "mixed-carousel";
}

export function validatePocCases(value: unknown): PocCase[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("cases JSON must be a non-empty array");
  const allowed = new Set<ExpectedInstagramCase>([
    "reel",
    "video",
    "image",
    "image-carousel",
    "video-carousel",
    "mixed-carousel",
  ]);
  const cases = value.map((item, index): PocCase => {
    const record = asRecord(item);
    const id = asString(record?.id);
    const expectedKind = asString(
      record?.expectedKind,
    ) as ExpectedInstagramCase | null;
    const url = asString(record?.url);
    if (!id || !expectedKind || !allowed.has(expectedKind) || !url)
      throw new Error(`invalid case at index ${index}`);
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || host !== "instagram.com")
      throw new Error(`case ${id} must use a public HTTPS Instagram URL`);
    const source = asString(record?.source);
    return {
      id,
      expectedKind,
      url,
      ...(source ? { source } : {}),
    };
  });
  if (new Set(cases.map((item) => item.id)).size !== cases.length)
    throw new Error("case ids must be unique");
  return cases;
}
