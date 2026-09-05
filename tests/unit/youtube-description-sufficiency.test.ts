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
    [
      "豚バラ白菜",
      `
【レシピメモ】
■豚バラ白菜
＜所要時間：20分＞
🔳材料（4人前の分量）
・白菜 1/4株（500g）
・豚バラ肉 200g
・ごま油 小さじ2
①白菜はよく洗い、葉と芯に2等分に切る。
②生姜は皮を剥き、細切りにする。
③フライパンにごま油を引き、豚肉を炒める。
《ポイント》
切り方を工夫します。
`,
    ],
    [
      "伊達巻",
      `
【クリームチーズ伊達巻】
＜材料＞
卵 2個
はんぺん 1/2枚
砂糖 大1.5
＜作り方＞
1 すべて合わせてミキサーで撹拌する。
2 温めたフライパンの表面全部に油を塗る。
3 アルミホイルで蓋をして蒸し焼きする。
【エビのガーリックハーブ焼き】
＜材料＞
有頭海老 4〜5尾
`,
    ],
    [
      "ハンバーグ",
      `
【ハンバーグ】
合い挽き肉 500g
塩 小さじ1
玉ねぎ 1個
※手順は動画を見ながら作ってね！
①玉ねぎはみじん切りにし、レンジで3分加熱する。
②すべての材料を入れてよく混ぜる。
③小さめなボール型に成形する。
【絶品！赤ワインソース】
詳しくは動画を見てね！
`,
    ],
  ])(
    "accepts the saved PoC description structure for %s",
    (_name, description) => {
      expect(assessYoutubeDescription(description)).toEqual({
        sufficient: true,
        reason: "ingredients_and_steps",
      });
    },
  );

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
