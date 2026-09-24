import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PORTRAIT_FRAME_NAME,
  PORTRAIT_FRAME_SIZE,
  frameArguments,
} from "../../marketing/app-store/src/frame-config.js";
import { slides } from "../../marketing/app-store/src/slides.js";

describe("App Store screenshot presentation", () => {
  it("selects the official portrait bezel explicitly", () => {
    const args = frameArguments("source.jpg", "bezels", "frames", "source");

    expect(args).toContain("--frame");
    expect(args[args.indexOf("--frame") + 1]).toBe(PORTRAIT_FRAME_NAME);
    expect(PORTRAIT_FRAME_NAME).toBe("iPhone 18 Pro - Burgundy - Portrait");
    expect(PORTRAIT_FRAME_SIZE).toEqual({ width: 1350, height: 2760 });
  });

  it("orders the story and reserves rotation for the designed compositions", () => {
    expect(slides).toHaveLength(6);
    expect(slides.map(({ id }) => id)).toEqual([
      "01-one-place",
      "02-unlimited",
      "03-url",
      "04-readable",
      "05-share",
      "06-want-to-cook",
    ]);

    const unlimited = slides[1];
    expect(unlimited.layout).toBe("fan");
    expect(unlimited.images).toHaveLength(3);
    expect(new Set(unlimited.images)).toHaveLength(3);
    expect(unlimited.screenPlacements).toEqual([
      { left: -170, top: 1020, width: 720, rotate: -12, z: 1 },
      { left: 235, top: 680, width: 850, rotate: -3, z: 3 },
      { left: 775, top: 1050, width: 720, rotate: 12, z: 2 },
    ]);

    const readable = slides[3];
    expect(readable.layout).toBe("duo-tilted");
    expect(readable.images).toHaveLength(2);
    expect(readable.screenPlacements).toEqual([
      { left: -90, top: 860, width: 780, rotate: -8, z: 1 },
      { left: 620, top: 1020, width: 780, rotate: 8, z: 2 },
    ]);

    expect(
      slides
        .filter(({ id }) => id !== "02-unlimited" && id !== "04-readable")
        .every((slide) => slide.screenPlacements == null),
    ).toBe(true);
  });

  it("aligns every instructional note with its highlighted target", () => {
    for (const slide of slides) {
      const ring = slide.annotations?.find(({ kind }) => kind === "ring");
      const note = slide.annotations?.find(({ kind }) => kind === "note");
      if (!ring || !note) continue;

      if (note.arrow === "left") {
        expect(note.x).toBeGreaterThan(ring.x + ring.w);
        expect(Math.abs(note.y - (ring.y + ring.h / 2))).toBeLessThan(2);
      }

      if (note.arrow === "down") {
        expect(note.y).toBeLessThan(ring.y);
        expect(note.x).toBeGreaterThan(ring.x);
        expect(note.x).toBeLessThan(ring.x + ring.w);
      }
    }
  });

  it("positions comparison labels beside their actual sections", () => {
    const comparison = slides.find(({ id }) => id === "04-readable");

    expect(comparison.labels).toEqual(["材料", "作り方"]);
    expect(comparison.labelPositions).toEqual([
      { x: 50, y: 69 },
      { x: 50, y: 20 },
    ]);
  });

  it("aligns action highlights and obscures only the share suggestion row", () => {
    const share = slides.find(({ id }) => id === "05-share");
    const wantToCook = slides.find(({ id }) => id === "06-want-to-cook");

    expect(share.annotations).toContainEqual({
      screen: 0,
      kind: "privacy-blur",
      x: 8,
      y: 51.5,
      w: 84,
      h: 15,
    });
    expect(share.annotations).toContainEqual({
      screen: 0,
      kind: "ring",
      x: 9.5,
      y: 69,
      w: 17,
      h: 11.2,
    });
    expect(wantToCook.annotations).toContainEqual({
      screen: 0,
      kind: "ring",
      x: 8.7,
      y: 55.3,
      w: 20,
      h: 3.1,
    });
    const wantToCookNote = wantToCook.annotations.find(
      ({ kind }) => kind === "note",
    );
    expect(wantToCookNote.text.split("\n").length).toBeGreaterThan(1);
  });

  it("rebalances the shortened one-line headlines and their phones", () => {
    const url = slides.find(({ id }) => id === "03-url");
    const share = slides.find(({ id }) => id === "05-share");
    const wantToCook = slides.find(({ id }) => id === "06-want-to-cook");

    expect(url.title).toEqual(["URLを貼るだけ"]);
    expect(url.titleSize).toBe(176);
    expect(url.phonePlacement).toEqual({ top: 500, width: 1130 });

    expect(share.title).toEqual(["シェアですぐ保存"]);
    expect(share.titleSize).toBe(144);
    expect(share.phonePlacement).toEqual({ top: 420, width: 1180 });

    expect(wantToCook.title).toHaveLength(2);
    expect(wantToCook.titleSize).toBeUndefined();
    expect(wantToCook.phonePlacement).toEqual({ top: 550, width: 1140 });
  });

  it("centers the marketing headlines", async () => {
    const css = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../marketing/app-store/src/styles.css",
      ),
      "utf8",
    );

    expect(css).toMatch(/\.copy\s*{[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/\.title\s*{[^}]*margin:\s*0 auto;/s);
    expect(css).toMatch(
      /\.title\s*{[^}]*font-size:\s*var\(--title-font-size,\s*150px\);/s,
    );
    expect(css).toMatch(/\.kicker\s*{[^}]*font-size:\s*70px;/s);
    expect(css).toMatch(/\.annotation--note\s*{[^}]*max-width:\s*620px;/s);
    expect(css).toMatch(/\.annotation--note\s*{[^}]*white-space:\s*pre-line;/s);
    expect(css).toMatch(/\.feature-bubble\s*{[^}]*font-size:\s*64px;/s);
  });

  it("names supported sources instead of grouping them as SNS or AI chat", () => {
    const firstSlide = slides.find(({ id }) => id === "01-one-place");
    const copy = JSON.stringify(firstSlide);
    const sourceNames = firstSlide.bubbles.map(({ text }) => text);
    const sourceIcons = firstSlide.bubbles.map(({ icon }) => icon);

    expect(copy).not.toContain("SNS");
    expect(copy).not.toContain("AIチャット");
    expect(sourceNames).toEqual([
      "TikTok",
      "Instagram",
      "YouTube",
      "Web",
      "ChatGPT",
      "Gemini",
    ]);
    expect(sourceIcons).toEqual([
      "tiktok",
      "instagram",
      "youtube",
      "web",
      "chatgpt",
      "gemini",
    ]);
  });

  it("uses one centered edge-to-edge background without a detached panel", async () => {
    const [css, html, background] = await Promise.all([
      readFile(
        path.resolve(
          import.meta.dirname,
          "../../marketing/app-store/src/styles.css",
        ),
        "utf8",
      ),
      readFile(
        path.resolve(
          import.meta.dirname,
          "../../marketing/app-store/src/index.html",
        ),
        "utf8",
      ),
      readFile(
        path.resolve(
          import.meta.dirname,
          "../../marketing/app-store/assets/background-kitchen-neutral.png",
        ),
      ),
    ]);

    expect(css).toContain('url("../assets/background-kitchen-neutral.png")');
    expect(css).toMatch(
      /\.artboard\s*{[^}]*--background-theme:\s*var\(--coral\);/s,
    );
    expect(css).toMatch(
      /background-image:[\s\S]*?var\(--background-theme\)[\s\S]*?url\("\.\.\/assets\/background-kitchen-neutral\.png"\)/,
    );
    expect(css).toMatch(/\.artboard\s*{[^}]*background-position:\s*center;/s);
    expect(css).toMatch(/\.artboard\s*{[^}]*background-size:\s*cover;/s);
    expect(css).not.toContain(".decor--one");
    expect(html).not.toContain("decor--one");
    expect(background.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
