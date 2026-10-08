import { youtubeVideoId } from "../../domain/recipe/url.js";

const UNAVAILABLE_SOURCE_LINK =
  "分析対象URLを取得できません。失敗ログを確認してください。";

export function analysisSourceLink(value: string): string {
  if (value.length > 4096) return UNAVAILABLE_SOURCE_LINK;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return UNAVAILABLE_SOURCE_LINK;

    const videoId = youtubeVideoId(url);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const destination = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : url.toString();
    // URL serialization permits parentheses; escape Markdown destination delimiters.
    const markdownDestination = destination.replace(
      /[()<>`]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `[分析対象URL](${markdownDestination})`;
  } catch {
    return UNAVAILABLE_SOURCE_LINK;
  }
}
