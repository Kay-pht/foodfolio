export type YoutubeDescriptionSufficiency =
  | { sufficient: true; reason: "ingredients_and_steps" }
  | {
      sufficient: false;
      reason:
        | "empty"
        | "video_reference_required"
        | "promotion_or_links"
        | "ingredients_missing"
        | "steps_missing";
    };

const INGREDIENT_HEADING =
  /^[【[〈《「『]?\s*(?:材料|食材|調味料|ingredients?)(?:\s*[（(][^）)]{0,20}[）)])?\s*[】\]〉》」』]?\s*[:：]?\s*$/iu;
const STEP_HEADING =
  /^[【[〈《「『]?\s*(?:作り方|作りかた|つくり方|つくりかた|手順|調理工程|instructions?|directions?)\s*[】\]〉》」』]?\s*[:：]?\s*$/iu;
const SECTION_HEADING =
  /^(?:[【[〈《「『(（][^\n]{1,24}[】\]〉》」』)）]|[^\n]{1,24}[:：])$/u;
const LIST_PREFIX = /^\s*(?:[-*・●◯○■□]|▪︎|\d{1,2}[.)．、:]|[①-⑳])\s*/u;
const QUANTITY =
  /(?:\d+(?:[.,/]\d+)?\s*(?:g|kg|mg|ml|l|cc|個|本|枚|片|玉|束|袋|缶|パック|カップ|杯|さじ|大さじ|小さじ|合|人分)|(?:大さじ|小さじ)\s*\d|適量|少々|ひとつまみ|お?好みで|to taste)/iu;
const COOKING_ACTION =
  /(?:切|刻|むく|剥|洗|混ぜ|和え|加え|入れ|炒め|焼|煮|茹|ゆで|蒸|揚げ|炊|温め|冷や|漬け|盛|かけ|絡め|こね|成形|裏返|取り出|火にかけ|heat|mix|add|cook|bake|boil|fry|serve)/iu;
const VIDEO_REFERENCE_REQUIRED =
  /(?:詳しくは|続きは|作り方は|手順は).{0,16}(?:動画|映像)(?:で|を|へ|に)|(?:動画|映像)(?:を|で).{0,12}(?:ご覧|確認|チェック)|(?:see|watch)\s+(?:the\s+)?video/iu;
const PROMOTION =
  /(?:チャンネル登録|フォロー|商品はこちら|購入はこちら|オンラインショップ|キャンペーン|スポンサー|subscribe|follow me|shop now)/iu;

function linesInSection(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (
      (INGREDIENT_HEADING.test(line) || STEP_HEADING.test(line)) &&
      !heading.test(line)
    )
      break;
    if (SECTION_HEADING.test(line) && !LIST_PREFIX.test(line)) break;
    result.push(line);
  }
  return result;
}

/**
 * Conservatively decides whether a YouTube description alone contains a
 * usable ingredient list and multiple cooking steps. Ambiguity is a fallback.
 */
export function assessYoutubeDescription(
  description: string,
): YoutubeDescriptionSufficiency {
  const normalized = description.replaceAll("\r\n", "\n").trim();
  if (!normalized) return { sufficient: false, reason: "empty" };
  if (VIDEO_REFERENCE_REQUIRED.test(normalized))
    return { sufficient: false, reason: "video_reference_required" };

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ingredientSection = linesInSection(lines, INGREDIENT_HEADING);
  const ingredientLines = ingredientSection.filter(
    (line) => QUANTITY.test(line) && !/^https?:\/\//iu.test(line),
  );
  if (ingredientLines.length < 2)
    return { sufficient: false, reason: "ingredients_missing" };

  const stepSection = linesInSection(lines, STEP_HEADING);
  const stepLines = stepSection.filter(
    (line) => COOKING_ACTION.test(line) && !/^https?:\/\//iu.test(line),
  );
  if (stepLines.length < 2)
    return { sufficient: false, reason: "steps_missing" };

  const promotionOrLinkLines = lines.filter(
    (line) => /https?:\/\//iu.test(line) || PROMOTION.test(line),
  );
  if (
    promotionOrLinkLines.length >= 3 &&
    promotionOrLinkLines.length >= ingredientLines.length + stepLines.length
  )
    return { sufficient: false, reason: "promotion_or_links" };

  return { sufficient: true, reason: "ingredients_and_steps" };
}
