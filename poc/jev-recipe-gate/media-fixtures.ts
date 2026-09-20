import type { YoutubeDescriptionSufficiency } from "../../src/domain/recipe/youtube-description-sufficiency.js";

export type MediaFixturePlatform =
  "youtube" | "instagram" | "tiktok" | "ai-chat";

export type MediaExpectedKind = "recipe" | "non-recipe";
export type MediaExpectedRoute = "zai" | "gemini" | "text" | "media";
export type FixtureProvenance =
  "existing-test-shape" | "controlled-hard-negative" | "live-url";

interface BaseMediaFixture {
  id: string;
  platform: MediaFixturePlatform;
  expectedKind: MediaExpectedKind | null;
  expectedRoute: MediaExpectedRoute | null;
  input: string | null;
  provenance: FixtureProvenance;
  rationale: string;
}

export interface YoutubeMediaFixture extends BaseMediaFixture {
  platform: "youtube";
  expectedRoute: "zai" | "gemini";
  title: string;
  description: string;
  youtubeSufficiencyOverride?: YoutubeDescriptionSufficiency;
}

export interface SocialMediaFixture extends BaseMediaFixture {
  platform: "instagram" | "tiktok";
  expectedRoute: "text" | "media";
}

export interface AiChatMediaFixture extends BaseMediaFixture {
  platform: "ai-chat";
  expectedRoute: null;
  channel: "chatgpt" | "gemini";
}

export type MediaRoutingFixture =
  YoutubeMediaFixture | SocialMediaFixture | AiChatMediaFixture;

function youtubeInput(title: string, description: string): string | null {
  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  if (!normalizedTitle && !normalizedDescription) return null;
  return [
    normalizedTitle ? `TITLE\n${normalizedTitle}` : "",
    normalizedDescription ? `DESCRIPTION\n${normalizedDescription}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function youtubeFixture(
  fixture: Omit<YoutubeMediaFixture, "platform" | "input">,
): YoutubeMediaFixture {
  return {
    ...fixture,
    platform: "youtube",
    input: youtubeInput(fixture.title, fixture.description),
  };
}

export const MEDIA_ROUTING_FIXTURES: readonly MediaRoutingFixture[] = [
  youtubeFixture({
    id: "youtube-clear-recipe-ja",
    expectedKind: "recipe",
    expectedRoute: "zai",
    provenance: "existing-test-shape",
    rationale:
      "A specific recipe with multiple quantified ingredients and multiple explicit cooking steps.",
    title: "豚バラ白菜",
    description:
      "材料\n豚バラ肉 200g\n白菜 1/4個\n作り方\n1. 白菜を切る\n2. 豚バラ肉を炒める",
  }),
  youtubeFixture({
    id: "youtube-clear-recipe-en",
    expectedKind: "recipe",
    expectedRoute: "zai",
    provenance: "controlled-hard-negative",
    rationale:
      "English-language complete recipe verifies that the route is not tied to Japanese headings.",
    title: "Simple garlic pasta",
    description:
      "Ingredients\nPasta 100g\nGarlic 2 cloves\nDirections\n1. Boil the pasta.\n2. Fry the garlic and mix with the pasta.",
  }),
  youtubeFixture({
    id: "youtube-ingredients-only",
    expectedKind: "recipe",
    expectedRoute: "gemini",
    provenance: "existing-test-shape",
    rationale:
      "The content is clearly one recipe, but the description lacks cooking steps and therefore requires video-aware fallback.",
    title: "豚バラ白菜",
    description: "材料\n豚バラ肉 200g\n白菜 1/4個",
  }),
  youtubeFixture({
    id: "youtube-steps-only",
    expectedKind: "recipe",
    expectedRoute: "gemini",
    provenance: "existing-test-shape",
    rationale:
      "The content is clearly one recipe, but the description lacks ingredient quantities.",
    title: "豚バラ白菜",
    description: "作り方\n1. 白菜を切る\n2. 豚バラ肉を炒める",
  }),
  youtubeFixture({
    id: "youtube-video-reference-required",
    expectedKind: "recipe",
    expectedRoute: "gemini",
    provenance: "existing-test-shape",
    rationale:
      "A specific recipe explicitly delegates its procedure to the video, so recipe classification alone must not select text-only extraction.",
    title: "豚バラ白菜",
    description:
      "材料\n豚バラ肉 200g\n白菜 1/4個\n作り方は詳しくは動画をご覧ください",
  }),
  youtubeFixture({
    id: "youtube-multi-recipe-roundup",
    expectedKind: "non-recipe",
    expectedRoute: "gemini",
    provenance: "controlled-hard-negative",
    rationale:
      "A roundup can satisfy the structural sufficiency heuristic while not representing one specific recipe; Jev is intended to add this semantic guard.",
    title: "今週の肉料理アイデア2選",
    description:
      "材料\n鶏肉 200g\n牛肉 200g\n作り方\n1. 鶏肉は焼く料理の例として紹介します\n2. 牛肉は煮る料理の例として紹介します",
  }),
  youtubeFixture({
    id: "youtube-promotion-only",
    expectedKind: "non-recipe",
    expectedRoute: "gemini",
    provenance: "existing-test-shape",
    rationale:
      "A promotional description contains no usable recipe and remains on the fallback route.",
    title: "新商品のお知らせ",
    description: "登録はこちら\nhttps://example.com",
  }),
  youtubeFixture({
    id: "youtube-no-text",
    expectedKind: null,
    expectedRoute: "gemini",
    provenance: "controlled-hard-negative",
    rationale:
      "No text means Jev cannot classify and the safe route is Gemini without consuming a Jev call.",
    title: "",
    description: "",
  }),

  {
    id: "instagram-complete-caption-ja",
    platform: "instagram",
    expectedKind: "recipe",
    expectedRoute: "text",
    provenance: "controlled-hard-negative",
    rationale:
      "A self-contained caption has enough evidence for text-only extraction.",
    input:
      "DESCRIPTION\n簡単トマトパスタ\n材料\nパスタ 100g\nトマト 1個\n作り方\n1. パスタを茹でる\n2. トマトと和える",
  },
  {
    id: "instagram-complete-caption-en",
    platform: "instagram",
    expectedKind: "recipe",
    expectedRoute: "text",
    provenance: "controlled-hard-negative",
    rationale:
      "A complete English caption provides a second text-sufficient positive.",
    input:
      "DESCRIPTION\nGarlic toast\nIngredients: bread 2 slices, garlic 1 clove. Steps: 1. Mix garlic with butter. 2. Spread it on bread and bake.",
  },
  {
    id: "instagram-recipe-title-only",
    platform: "instagram",
    expectedKind: "recipe",
    expectedRoute: "media",
    provenance: "existing-test-shape",
    rationale:
      "A recipe title can be semantically recipe content while still being insufficient for text extraction.",
    input: "DESCRIPTION\n絶品パスタ #レシピ",
  },
  {
    id: "instagram-video-reference",
    platform: "instagram",
    expectedKind: "recipe",
    expectedRoute: "media",
    provenance: "controlled-hard-negative",
    rationale:
      "The post is about one recipe but explicitly leaves ingredients and procedure to the media.",
    input:
      "DESCRIPTION\n肉巻きポテトのレシピ。材料と作り方は動画内で紹介しています。",
  },
  {
    id: "instagram-food-review",
    platform: "instagram",
    expectedKind: "non-recipe",
    expectedRoute: "media",
    provenance: "controlled-hard-negative",
    rationale:
      "A restaurant review is food-related but is not one specific cooking recipe.",
    input:
      "DESCRIPTION\n駅前の新しいカフェで季節のパスタを食べました。店内の雰囲気とおすすめメニューを紹介します。",
  },
  {
    id: "instagram-no-text",
    platform: "instagram",
    expectedKind: null,
    expectedRoute: "media",
    provenance: "existing-test-shape",
    rationale:
      "Absent metadata text must bypass Jev and retain media analysis.",
    input: null,
  },

  {
    id: "tiktok-complete-caption",
    platform: "tiktok",
    expectedKind: "recipe",
    expectedRoute: "text",
    provenance: "controlled-hard-negative",
    rationale:
      "A self-contained TikTok caption should be eligible for text-only analysis.",
    input:
      "TITLE\nレンジ卵丼\n材料 卵2個 ご飯200g\n作り方 1. 卵を混ぜる 2. 加熱してご飯にのせる",
  },
  {
    id: "tiktok-title-only",
    platform: "tiktok",
    expectedKind: "recipe",
    expectedRoute: "media",
    provenance: "existing-test-shape",
    rationale:
      "A recipe-looking title alone is not enough to reconstruct ingredients and steps.",
    input: "TITLE\n絶品パスタ",
  },
  {
    id: "tiktok-photo-hashtag-only",
    platform: "tiktok",
    expectedKind: "recipe",
    expectedRoute: "media",
    provenance: "existing-test-shape",
    rationale:
      "This mirrors the current photo-post test shape: clearly recipe-themed text but insufficient details.",
    input: "DESCRIPTION\n肉巻きポテト #レシピ",
  },
  {
    id: "tiktok-media-reference",
    platform: "tiktok",
    expectedKind: "recipe",
    expectedRoute: "media",
    provenance: "controlled-hard-negative",
    rationale:
      "The caption names a specific recipe while delegating the actual ingredients and process to the video.",
    input:
      "DESCRIPTION\n鶏むね肉の照り焼き。材料と詳しい作り方は動画を見てください。",
  },
  {
    id: "tiktok-food-review",
    platform: "tiktok",
    expectedKind: "non-recipe",
    expectedRoute: "media",
    provenance: "controlled-hard-negative",
    rationale: "A food review is a hard negative for a recipe classifier.",
    input:
      "TITLE\nコンビニ新作パスタ3種類を食べ比べ。味と価格をレビューします。",
  },
  {
    id: "tiktok-no-text",
    platform: "tiktok",
    expectedKind: null,
    expectedRoute: "media",
    provenance: "controlled-hard-negative",
    rationale:
      "No usable caption means the proposed route must stay on media analysis without Jev.",
    input: null,
  },

  {
    id: "ai-chat-iterative-recipe",
    platform: "ai-chat",
    channel: "chatgpt",
    expectedKind: "recipe",
    expectedRoute: null,
    provenance: "existing-test-shape",
    rationale:
      "An ordered conversation contains one recipe followed by explicit modifications to the same dish.",
    input:
      "MESSAGE 1 ROLE=user\nパスタのレシピを教えて\n\nMESSAGE 2 ROLE=assistant\n材料: パスタ100g、トマト1個。作り方: 茹でてトマトと和えます。\n\nMESSAGE 3 ROLE=user\nトマトは使わず、ごま油を使って\n\nMESSAGE 4 ROLE=assistant\n材料をパスタ100g、ごま油小さじ1に変更し、茹でたパスタと和えます。",
  },
  {
    id: "ai-chat-single-recipe",
    platform: "ai-chat",
    channel: "gemini",
    expectedKind: "recipe",
    expectedRoute: null,
    provenance: "existing-test-shape",
    rationale:
      "A short shared conversation asks for and receives one concrete recipe.",
    input:
      "MESSAGE 1 ROLE=user\nオムライスのレシピを教えて\n\nMESSAGE 2 ROLE=assistant\n材料: ご飯200g、卵2個、ケチャップ大さじ2。作り方: ご飯を炒め、卵で包みます。",
  },
  {
    id: "ai-chat-meal-plan",
    platform: "ai-chat",
    channel: "chatgpt",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale:
      "A weekly meal plan mentions multiple dishes rather than teaching one specific recipe.",
    input:
      "MESSAGE 1 ROLE=user\n一週間の夕食案を考えて\n\nMESSAGE 2 ROLE=assistant\n月曜はカレー、火曜は焼き魚、水曜はパスタ、木曜は鍋、金曜は丼がおすすめです。",
  },
  {
    id: "ai-chat-restaurant-recommendations",
    platform: "ai-chat",
    channel: "gemini",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale:
      "Restaurant recommendations are food-domain hard negatives but not cooking instructions.",
    input:
      "MESSAGE 1 ROLE=user\n横浜でパスタがおいしい店を3つ教えて\n\nMESSAGE 2 ROLE=assistant\n条件に合う店をエリア別に比較します。営業時間や予算も確認してください。",
  },
  {
    id: "ai-chat-cooking-tips",
    platform: "ai-chat",
    channel: "chatgpt",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale:
      "General cooking advice does not constitute one specific recipe.",
    input:
      "MESSAGE 1 ROLE=user\n炒め物を水っぽくしないコツは？\n\nMESSAGE 2 ROLE=assistant\n食材の水分を拭き、フライパンを十分温め、入れすぎないことが基本です。",
  },
  {
    id: "ai-chat-travel-plan",
    platform: "ai-chat",
    channel: "gemini",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale:
      "An unrelated conversation checks ordinary non-recipe rejection.",
    input:
      "MESSAGE 1 ROLE=user\n京都を一日で回るプランを作って\n\nMESSAGE 2 ROLE=assistant\n午前は東山、午後は嵐山を回る案があります。",
  },
  {
    id: "ai-chat-programming-help",
    platform: "ai-chat",
    channel: "chatgpt",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale: "A technical conversation is an unambiguous non-recipe control.",
    input:
      "MESSAGE 1 ROLE=user\nTypeScriptの型エラーを直したい\n\nMESSAGE 2 ROLE=assistant\nエラー位置と型定義を確認し、unionの絞り込みを追加してください。",
  },
  {
    id: "ai-chat-multiple-recipes",
    platform: "ai-chat",
    channel: "gemini",
    expectedKind: "non-recipe",
    expectedRoute: null,
    provenance: "controlled-hard-negative",
    rationale:
      "A list of several recipe ideas is not one specific recipe under the Jev gate definition.",
    input:
      "MESSAGE 1 ROLE=user\n卵を使う料理を5つ挙げて\n\nMESSAGE 2 ROLE=assistant\nオムレツ、親子丼、茶碗蒸し、卵サンド、プリンがあります。",
  },
] as const;
