import { describe, expect, it } from "vitest";
import { assessYoutubeDescription } from "../../src/domain/recipe/youtube-description-sufficiency.js";

describe("assessYoutubeDescription", () => {
  it("accepts only a clear ingredient list with quantities and multiple steps", () => {
    expect(
      assessYoutubeDescription(`
【材料（2人分）】
豚バラ肉 200g
白菜 1/4個
サラダ油 適量
【作り方】
1. 白菜を切る
2. 豚バラ肉を炒める
3. 白菜を加えて煮る
`),
    ).toEqual({ sufficient: true, reason: "ingredients_and_steps" });
  });

  it.each([
    ["empty", "", "empty"],
    ["overview", "10分で作れる簡単な晩ごはんです。", "ingredients_missing"],
    ["ingredients only", "材料\n豚肉 200g\n白菜 1/4個", "steps_missing"],
    [
      "steps only",
      "作り方\n1. 白菜を切る\n2. 豚肉を炒める",
      "ingredients_missing",
    ],
    [
      "links and promotion",
      "材料\n豚肉 200g\n白菜 1個\n作り方\n1. 白菜を切る\n2. 豚肉を炒める\nチャンネル登録はこちら\nhttps://example.com\n商品はこちら\nhttps://example.com/item",
      "promotion_or_links",
    ],
    [
      "video reference required",
      "材料\n豚肉 200g\n白菜 1/4個\n作り方は詳しくは動画をご覧ください",
      "video_reference_required",
    ],
    [
      "ambiguous single entries",
      "材料\n豚肉 200g\n作り方\n1. 豚肉を焼く",
      "ingredients_missing",
    ],
  ])("rejects %s", (_name, description, reason) => {
    expect(assessYoutubeDescription(description)).toEqual({
      sufficient: false,
      reason,
    });
  });
});
