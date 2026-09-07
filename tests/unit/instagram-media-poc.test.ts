import { describe, expect, it } from "vitest";
import {
  classifyInstagramMedia,
  parseYtDlpInstagramJson,
  validatePocCases,
} from "../../poc/instagram-media/manifest.js";

describe("Instagram media PoC manifest parser", () => {
  it("uses the largest thumbnail as a single image", () => {
    const parsed = parseYtDlpInstagramJson({
      description: "材料は画像内",
      formats: [],
      thumbnails: [
        { url: "https://cdn.example/small.jpg", width: 320, height: 320 },
        { url: "https://cdn.example/large.jpg", width: 1080, height: 1350 },
      ],
      http_headers: { Referer: "https://www.instagram.com/" },
    });

    expect(parsed).toMatchObject({
      caption: "材料は画像内",
      unavailableEntryCount: 0,
      assets: [
        {
          index: 1,
          kind: "image",
          url: "https://cdn.example/large.jpg",
          width: 1080,
          height: 1350,
        },
      ],
    });
    expect(
      classifyInstagramMedia("https://www.instagram.com/p/image/", parsed),
    ).toBe("image");
  });

  it("prefers a combined video format over video-only and audio-only formats", () => {
    const parsed = parseYtDlpInstagramJson({
      formats: [
        {
          url: "https://cdn.example/video-only.mp4",
          width: 1080,
          height: 1920,
          acodec: "none",
        },
        {
          url: "https://cdn.example/audio-only.m4a",
          vcodec: "none",
        },
        {
          url: "https://cdn.example/combined.mp4",
          width: 720,
          height: 1280,
        },
      ],
      thumbnails: [],
    });

    expect(parsed.assets[0]).toMatchObject({
      kind: "video",
      url: "https://cdn.example/combined.mp4",
    });
    expect(
      classifyInstagramMedia("https://www.instagram.com/reel/video/", parsed),
    ).toBe("reel");
  });

  it("preserves mixed carousel order", () => {
    const parsed = parseYtDlpInstagramJson({
      entries: [
        {
          formats: [],
          thumbnails: [
            { url: "https://cdn.example/01.jpg", width: 1080, height: 1350 },
          ],
        },
        {
          formats: [
            { url: "https://cdn.example/02.mp4", width: 1080, height: 1920 },
          ],
          thumbnails: [],
        },
        {
          formats: [],
          thumbnails: [
            { url: "https://cdn.example/03.jpg", width: 1080, height: 1350 },
          ],
        },
      ],
    });

    expect(parsed.assets.map(({ index, kind }) => ({ index, kind }))).toEqual([
      { index: 1, kind: "image" },
      { index: 2, kind: "video" },
      { index: 3, kind: "image" },
    ]);
    expect(
      classifyInstagramMedia("https://www.instagram.com/p/mixed/", parsed),
    ).toBe("mixed-carousel");
  });

  it("does not classify a carousel when yt-dlp returned unavailable entries", () => {
    const parsed = parseYtDlpInstagramJson({
      entries: [
        null,
        {
          formats: [],
          thumbnails: [
            { url: "https://cdn.example/02.jpg", width: 1080, height: 1350 },
          ],
        },
      ],
    });

    expect(parsed.unavailableEntryCount).toBe(1);
    expect(
      classifyInstagramMedia("https://www.instagram.com/p/incomplete/", parsed),
    ).toBe("unknown");
  });

  it("defaults cases to assert mode and accepts explicit probe metadata", () => {
    const cases = validatePocCases([
      {
        id: "reel",
        expectedKind: "reel",
        url: "https://www.instagram.com/reel/abc/",
      },
      {
        id: "stale-image",
        expectedKind: "image",
        mode: "probe",
        url: "https://www.instagram.com/p/def/",
        note: "Historical sample; not decision eligible",
      },
    ]);

    expect(cases).toEqual([
      {
        id: "reel",
        expectedKind: "reel",
        mode: "assert",
        url: "https://www.instagram.com/reel/abc/",
      },
      {
        id: "stale-image",
        expectedKind: "image",
        mode: "probe",
        url: "https://www.instagram.com/p/def/",
        note: "Historical sample; not decision eligible",
      },
    ]);
  });

  it("rejects invalid modes and non-HTTPS Instagram URLs", () => {
    expect(() =>
      validatePocCases([
        {
          id: "bad-mode",
          expectedKind: "image",
          mode: "skip",
          url: "https://www.instagram.com/p/abc/",
        },
      ]),
    ).toThrow("invalid mode");

    expect(() =>
      validatePocCases([
        {
          id: "bad-url",
          expectedKind: "image",
          url: "http://instagram.com/p/abc/",
        },
      ]),
    ).toThrow("public HTTPS Instagram URL");
  });
});
