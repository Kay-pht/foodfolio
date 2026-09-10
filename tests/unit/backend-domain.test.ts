import { describe, expect, it } from "vitest";
import {
  parseAndNormalizeRecipeUrl,
  sourceTypeForUrl,
  youtubeVideoId,
} from "../../src/domain/recipe/url.js";
import { normalizeTagName } from "../../src/domain/tag/normalize.js";
import {
  decodeSyncCursor,
  encodeSyncCursor,
} from "../../src/shared/sync-cursor.js";
import {
  isPublicAddress,
  publicLookupResult,
} from "../../src/infrastructure/url/safe-http-client.js";

describe("recipe URL", () => {
  it("normalizes tracking, query order, fragment and default port", () => {
    const result = parseAndNormalizeRecipeUrl(
      "HTTPS://Example.COM:443/path?z=2&utm_source=x&a=1#part",
    );
    expect(result).toEqual({
      originalUrl: "HTTPS://Example.COM:443/path?z=2&utm_source=x&a=1#part",
      normalizedUrl: "https://example.com/path?a=1&z=2",
      sourceType: "web",
    });
  });
  it("uses the YouTube video id as canonical identity", () => {
    const parsed = new URL("https://youtu.be/abcDEF_1234?t=10");
    expect(youtubeVideoId(parsed)).toBe("abcDEF_1234");
    expect(sourceTypeForUrl(parsed)).toBe("youtube");
    expect(parseAndNormalizeRecipeUrl(parsed.toString()).normalizedUrl).toBe(
      "https://www.youtube.com/watch?v=abcDEF_1234",
    );
  });

  it.each(["photo", "video"])(
    "uses the TikTok author, %s kind, and post id as canonical identity",
    (kind) => {
      const parsed = parseAndNormalizeRecipeUrl(
        `https://m.tiktok.com/@chef/${kind}/7526427403409689874?_r=1&_t=share&utm_source=test`,
      );

      expect(parsed.normalizedUrl).toBe(
        `https://www.tiktok.com/@chef/${kind}/7526427403409689874`,
      );
    },
  );
  it("rejects non HTTP URLs", () =>
    expect(() => parseAndNormalizeRecipeUrl("file:///etc/passwd")).toThrow(
      "HTTP(S)",
    ));
});

describe("tag normalization", () => {
  it("normalizes unicode, spaces and ASCII case", () =>
    expect(normalizeTagName("  ＱＵＩＣＫ   Meal ")).toEqual({
      name: "QUICK Meal",
      normalizedName: "quick meal",
    }));
  it("rejects empty values", () =>
    expect(() => normalizeTagName("   ")).toThrow());
});

describe("sync cursor", () => {
  it("round trips as an opaque value", () => {
    const value = { updatedAt: "2026-08-27T00:00:00.000Z", id: "abc" };
    expect(decodeSyncCursor(encodeSyncCursor(value))).toEqual(value);
  });
  it("rejects malformed values", () =>
    expect(() => decodeSyncCursor("not-a-cursor")).toThrow(
      "Invalid sync cursor",
    ));
});

describe("SSRF address validation", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"])(
    "blocks %s",
    (address) => expect(isPublicAddress(address)).toBe(false),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows %s",
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it("preserves the DNS lookup all option contract", () => {
    const addresses = [
      { address: "8.8.8.8", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const },
    ];
    expect(publicLookupResult(addresses, true)).toEqual(addresses);
    expect(publicLookupResult(addresses, false)).toEqual(addresses[0]);
  });
  it("rejects the complete DNS result when any address is unsafe", () =>
    expect(() =>
      publicLookupResult(
        [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        true,
      ),
    ).toThrow("Unsafe DNS result"));
});
