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
  /^(?:材料|食材|調味料|ingredients?)(?:\s*\([^)]{0,20}\))?\s*[>\]〉》」』】]?\s*[:：]?\s*$/iu;
const STEP_HEADING =
  /^(?:作り方|作りかた|つくり方|つくりかた|手順|調理工程|instructions?|directions?)\s*[>\]〉》」』】]?\s*[:：]?\s*$/iu;
const SECTION_HEADING =
  /^(?:[【[<〈《「『(（][^\n]{1,24}[>\]〉》」』)）】]|[^\n]{1,24}[:：])$/u;
const DECORATIVE_PREFIX = /^[^\p{L}\p{N}]+/u;
const LIST_PREFIX = /^\s*(?:[-*・●◯○■□]|▪︎|\d{1,2}[.)．、:]|[①-⑳])\s*/u;
const NUMBERED_STEP = /^\s*(?:\d{1,2}[.)．、:]|[①-⑳])\s*/u;
const QUANTITY =
  /(?:\d+(?:[.,/]\d+)?\s*(?:g|kg|mg|ml|l|cc|個|本|枚|片|玉|束|袋|缶|パック|カップ|杯|さじ|大さじ|小さじ|合|人分)|(?:大さじ|小さじ|大|小)\s*\d|適量|少々|ひとつまみ|お?好みで|to taste)/iu;
const COOKING_ACTION =
  /(?:切|刻|むく|剥|洗|混ぜ|合わせ|和え|加え|入れ|流し|炒め|焼|煮|茹|ゆで|蒸|揚げ|炊|温め|加熱|冷や|漬け|盛|かけ|絡め|こね|成形|裏返|取り出|火にかけ|heat|mix|add|cook|bake|boil|fry|serve)/iu;
const VIDEO_REFERENCE_REQUIRED =
  /(?:詳しくは|続きは|作り方は|手順は).{0,16}(?:動画|映像)(?:で|を|へ|に)|(?:動画|映像)(?:を|で).{0,12}(?:ご覧|確認|チェック)|(?:see|watch)\s+(?:the\s+)?video/iu;
const PROMOTION =
  /(?:チャンネル登録|フォロー|商品はこちら|購入はこちら|オンラインショップ|キャンペーン|スポンサー|subscribe|follow me|shop now)/iu;

function withoutDecoration(line: string): string {
  return line.replace(DECORATIVE_PREFIX, "").trim();
}

function isIngredientHeading(line: string): boolean {
  return INGREDIENT_HEADING.test(withoutDecoration(line));
}

function isStepHeading(line: string): boolean {
  return STEP_HEADING.test(withoutDecoration(line));
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADING.test(line) && !LIST_PREFIX.test(line);
}

interface RecipeEvidence {
  ingredientLines: string[];
  stepLines: string[];
  scopedLines: string[];
}

function findRecipeEvidence(lines: string[]): RecipeEvidence {
  const explicitIngredientStart = lines.findIndex(isIngredientHeading);
  const searchStart =
    explicitIngredientStart >= 0 ? explicitIngredientStart + 1 : 0;
  const explicitStepStart = lines.findIndex(
    (line, index) => index >= searchStart && isStepHeading(line),
  );
  const numberedStepStart = lines.findIndex(
    (line, index) =>
      index >= searchStart &&
      NUMBERED_STEP.test(line) &&
      COOKING_ACTION.test(line),
  );
  const stepHeading = explicitStepStart >= 0;
  const stepStart = stepHeading ? explicitStepStart : numberedStepStart;

  if (stepStart < 0) {
    const ingredientLines =
      explicitIngredientStart < 0
        ? []
        : lines
            .slice(explicitIngredientStart + 1)
            .filter(
              (line) => QUANTITY.test(line) && !/^https?:\/\//iu.test(line),
            );
    return { ingredientLines, stepLines: [], scopedLines: lines };
  }

  let ingredientStart = explicitIngredientStart;
  if (ingredientStart < 0) {
    for (let index = stepStart - 1; index >= 0; index -= 1) {
      if (isSectionHeading(lines[index] ?? "")) {
        ingredientStart = index;
        break;
      }
    }
  }

  if (ingredientStart < 0 || ingredientStart >= stepStart)
    return { ingredientLines: [], stepLines: [], scopedLines: lines };

  const ingredientLines = lines
    .slice(ingredientStart + 1, stepStart)
    .filter((line) => QUANTITY.test(line) && !/^https?:\/\//iu.test(line));

  const firstStepLine = stepHeading ? stepStart + 1 : stepStart;
  let scopeEnd = lines.length;
  for (let index = firstStepLine; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      index > firstStepLine &&
      (isIngredientHeading(line) ||
        isStepHeading(line) ||
        isSectionHeading(line))
    ) {
      scopeEnd = index;
      break;
    }
  }
  const stepLines = lines
    .slice(firstStepLine, scopeEnd)
    .filter(
      (line) =>
        COOKING_ACTION.test(line) &&
        !/^https?:\/\//iu.test(line) &&
        (stepHeading || NUMBERED_STEP.test(line)),
    );

  return {
    ingredientLines,
    stepLines,
    scopedLines: lines.slice(ingredientStart, scopeEnd),
  };
}

/**
 * Conservatively decides whether a YouTube description alone contains a
 * usable ingredient list and multiple cooking steps. Ambiguity is a fallback.
 */
export function assessYoutubeDescription(
  description: string,
): YoutubeDescriptionSufficiency {
  const normalized = description
    .replaceAll("\r\n", "\n")
    .replaceAll(
      /[①-⑳]/gu,
      (marker) => `${"①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳".indexOf(marker) + 1}.`,
    )
    .normalize("NFKC")
    .trim();
  if (!normalized) return { sufficient: false, reason: "empty" };

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const { ingredientLines, stepLines, scopedLines } = findRecipeEvidence(lines);

  if (ingredientLines.length >= 2 && stepLines.length >= 2) {
    const promotionOrLinkLines = scopedLines.filter(
      (line) => /https?:\/\//iu.test(line) || PROMOTION.test(line),
    );
    if (
      promotionOrLinkLines.length >= 3 &&
      promotionOrLinkLines.length >= ingredientLines.length + stepLines.length
    )
      return { sufficient: false, reason: "promotion_or_links" };
    return { sufficient: true, reason: "ingredients_and_steps" };
  }

  if (VIDEO_REFERENCE_REQUIRED.test(scopedLines.join("\n")))
    return { sufficient: false, reason: "video_reference_required" };
  if (ingredientLines.length < 2)
    return { sufficient: false, reason: "ingredients_missing" };
  return { sufficient: false, reason: "steps_missing" };
}
