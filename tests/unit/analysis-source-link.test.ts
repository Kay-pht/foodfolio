import { describe, expect, it } from "vitest";
import { analysisSourceLink } from "../../src/application/analysis/source-link.js";

describe("analysis alert source links", () => {
  it.each([
    [
      "https://user:password@example.com/recipe?access_token=secret&utm_source=share&id=42#private",
      "https://example.com/recipe",
    ],
    [
      "https://www.instagram.com/p/post-123/?igsh=secret#private",
      "https://www.instagram.com/p/post-123/",
    ],
    [
      "https://www.tiktok.com/@chef/video/123456?share_token=secret",
      "https://www.tiktok.com/@chef/video/123456",
    ],
    [
      "https://lite.tiktok.com/t/abc123/?share_token=secret",
      "https://lite.tiktok.com/t/abc123/",
    ],
    [
      "https://chatgpt.com/share/share-id?token=secret#private",
      "https://chatgpt.com/share/share-id",
    ],
    [
      "https://gemini.google.com/share/share-id?utm_source=share",
      "https://gemini.google.com/share/share-id",
    ],
    ["http://[::1]:8080/recipe?id=42", "http://[::1]:8080/recipe"],
    [
      "https://example.com/レシピ",
      "https://example.com/%E3%83%AC%E3%82%B7%E3%83%94",
    ],
  ])("sanitizes %s without altering its source path", (input, destination) => {
    expect(analysisSourceLink(input)).toBe(`[分析対象URL](${destination})`);
  });

  it.each([
    "https://user:password@www.youtube.com/watch?v=abcdefghijk&access_token=secret&utm_source=share#private",
    "https://m.youtube.com/watch?v=abcdefghijk&list=secret",
    "https://youtu.be/abcdefghijk?si=secret&t=20",
    "https://www.youtube.com/shorts/abcdefghijk?feature=share",
    "https://www.youtube-nocookie.com/embed/abcdefghijk?token=secret",
    "https://www.youtube.com/live/abcdefghijk?utm_source=share",
  ])("keeps only the validated YouTube identifier for %s", (input) => {
    expect(analysisSourceLink(input)).toBe(
      "[分析対象URL](https://www.youtube.com/watch?v=abcdefghijk)",
    );
  });

  it.each([
    "https://youtube.com.evil.example/watch?v=abcdefghijk&token=secret",
    "https://www.youtube.com/watch?v=bad&token=secret",
    "https://www.youtube.com/watch?v=abc%29%5Bevil%5D&token=secret",
  ])(
    "does not retain query values from an unrecognized YouTube target %s",
    (input) => {
      expect(analysisSourceLink(input)).not.toContain("?");
    },
  );

  it("encodes delimiters that could inject Markdown links or mentions", () => {
    expect(
      analysisSourceLink(
        "https://example.com/recipe)[evil](https://evil.example/`@here`)?token=secret",
      ),
    ).toBe(
      "[分析対象URL](https://example.com/recipe%29[evil]%28https://evil.example/%60@here%60%29)",
    );
  });

  it.each([
    "not a URL",
    "",
    "javascript:alert(1)",
    "file:///private/secret",
    "data:text/plain,secret",
    `https://example.com/${"a".repeat(4096)}`,
  ])("uses controlled fallback text for an unusable input", (input) => {
    expect(analysisSourceLink(input)).toBe(
      "分析対象URLを取得できません。失敗ログを確認してください。",
    );
  });

  it("accepts a URL at the existing input length boundary", () => {
    const prefix = "https://example.com/";
    const input = prefix + "a".repeat(4096 - prefix.length);
    expect(analysisSourceLink(input)).toBe(`[分析対象URL](${input})`);
  });
});
