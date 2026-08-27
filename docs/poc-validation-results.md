# foodfolio MVP PoC検証結果

## 1. 本書の位置づけ

`docs/poc-validation-plan.md` に基づくPoCの実施結果を記録する。

本書では、2026-08-27時点でChatGPTのチャット環境内から実施できた範囲のみを完了扱いにする。

実APIキー、ブラウザ実行環境、実機等が必要な項目は未完了のまま残す。

---

## 2. 進捗サマリー

### PoC 1 — 外部URL情報取得

- [x] 一般Webの実レシピページで本文・材料・人数・調理時間・手順を取得できることを確認
- [x] クラシルの実レシピページで本文・材料・人数・調理時間・手順を取得できることを確認
- [x] クックパッドの実レシピについて、レシピ本文・材料・人数・手順が取得可能なケースを確認
- [x] YouTubeの実動画について、説明欄に材料・人数・所要時間・手順が含まれ、構造化可能なケースを確認
- [ ] クックパッドの本番Backend相当の直接HTTP取得方式を確定
- [ ] YouTubeの本番取得方式を確定
- [ ] Instagramの実投稿URLで取得方式を検証
- [ ] TikTokの実投稿URLで取得方式を検証
- [ ] 各対象サービスを「MVP利用可能 / 条件付き / 非対応」に最終分類

### PoC 2 — AIレシピ構造化

- [x] foodfolio用の暫定 `ExtractedRecipe` JSON Schemaを作成
- [x] 基準データ4件を作成
- [x] Schema形状・材料precision / recall・分量一致率を測る評価スクリプトを作成
- [x] ChatGPT内で4件を構造化し、評価スクリプトを実行するスモークテストを完了
- [x] AI候補の公式料金を再確認し、比較用の料金ベースラインを作成
- [ ] Gemini実APIで同一fixtureを実行
- [ ] OpenAI実APIで同一fixtureを実行
- [ ] Qwen実APIで同一fixtureを実行
- [ ] DeepSeek実APIで同一fixtureを実行
- [ ] 必要に応じてClaude実APIで同一fixtureを実行
- [ ] Provider / Modelを精度・hallucination・Schema成功率・コストで比較
- [ ] MVP採用Provider / Modelを確定

### PoC 3 — URL取得からAI解析までの統合確認

- [x] 取得済みの実レシピ情報4件を `ExtractedRecipe` へ変換するチャット内E2Eスモークテストを完了
- [x] Schema validation相当の構造チェックを通過することを確認
- [ ] PoC 1で確定した本番候補のURL取得方式からAI入力テキストを生成
- [ ] 採用AI Provider / Modelの実APIへ入力
- [ ] 実API出力をSchema validation
- [ ] MVP主要ソースで最終E2E確認

---

## 3. PoC 1 実測結果

### 3.1 使用したサンプル

| Source | URL | チャット環境で確認できた情報 |
| --- | --- | --- |
| 一般Web | https://www.kikkoman.co.jp/homecook/search/recipe/00050326/ | 料理名、2人分、15分、材料、分量、手順 |
| クラシル | https://www.kurashiru.com/recipes/a3b1f093-1f5e-4114-8cc8-8869e8e6871d | 料理名、2人前、20分、材料、分量、手順 |
| クックパッド | https://cookpad.com/jp/recipes/21712598 | 料理名、1〜2人分、材料、分量、手順 |
| YouTube | https://www.youtube.com/watch?v=0to72EbNg8A | 動画説明欄から料理名相当、4人前、20分、材料、分量、手順 |

### 3.2 現時点の判定

| Source | レシピ情報取得 | 本番取得方式 | 暫定判定 | 備考 |
| --- | --- | --- | --- | --- |
| 一般Web | 成功 | 未確定 | 有望 | HTMLからレシピセクションを抽出できるページを確認 |
| クラシル | 成功 | 未確定 | 有望 | ページ本文に構造化しやすい材料・手順が存在 |
| クックパッド | 成功例あり | 未確定 | 有望だが要追加検証 | チャットの検索取得では本文を確認できたが、直接ページopenは安定確認できていない |
| YouTube | 成功例あり | 未確定 | 条件付き候補 | 説明欄にレシピが書かれている動画では十分な情報が得られた。通常ページopenでは説明欄を取得できないケースを確認 |
| Instagram | 未実施 | 未確定 | 未確定 | チャット環境では実投稿の取得検証を完了できず |
| TikTok | 一部公開情報のみ | 未確定 | 未確定 | 個別投稿URLの直接取得検証を完了できず |

### 3.3 SNS系で確認した事項

YouTubeは、サンプル動画の説明欄自体にはレシピ情報が十分含まれていたが、通常の動画ページ取得では説明欄が得られないケースがあった。

YouTube Data APIのVideo `snippet` には `description` が定義されているため、本番候補方式としてData API利用を検討できる。ただしAPIキーを利用した実取得はこのPoCでは未実施である。

TikTok公式Display APIのVideo Objectには `video_description` / `title` 等が存在する一方、Display APIは認可を伴う利用フローを前提とする。任意のユーザーが貼り付けた第三者投稿URLをfoodfolioから取得する方式として利用可能かは、この結果だけでは確定しない。

---

## 4. Recipe Schema PoC

作成ファイル：

- `poc/shared/recipe-schema.json`

暫定Schemaでは以下を扱う。

- `title`
- `servings.value`
- `servings.raw`
- `cookingTimeMinutes`
- `genre`
- `ingredients[].name`
- `ingredients[].amount`
- `steps[]`

### 4.1 PoCで得たSchema上の発見

人数は単純な整数だけでは表現できない。

クックパッドのサンプルでは `1〜2人分` のような範囲表記を確認した。

MVPの人数変更は単一の基準人数から比例計算するため、暫定Schemaでは以下のように扱う。

```json
{
  "servings": {
    "value": null,
    "raw": "1〜2人分"
  }
}
```

単一数値へ安全に正規化できない場合は `value = null` とし、原文を `raw` に保持する。

これにより、原典に人数表記が存在していても基準人数を一意に決められない場合は、人数変更UIの対象外にできる。

このデータモデルはPoC段階の暫定案であり、正式なDBモデルは実装設計で確定する。

---

## 5. AI評価基盤

作成ファイル：

- `poc/ai-extraction/results/expected.json`
- `poc/ai-extraction/results/chatgpt-baseline.json`
- `poc/ai-extraction/evaluate.mjs`

評価スクリプトでは現時点で以下を確認する。

- 必須フィールドの構造チェック
- title一致
- servings数値一致
- cooking time一致
- ingredient precision
- ingredient recall
- ingredient amount完全一致率
- step件数

実行例：

```bash
node poc/ai-extraction/evaluate.mjs
```

### 5.1 チャット内スモークテスト結果

4ケースについて評価スクリプトを実行し、以下を確認した。

```text
cases: 4
schemaSuccessRate: 1.0
ingredientPrecision: 1.0
ingredientRecall: 1.0
ingredientAmountExactRate: 1.0
```

この値は **ChatGPT内で取得内容を確認しながら作成したbaselineが評価基盤を正常に通過することを確認するスモークテスト** である。

独立したAI Provider間の性能比較結果ではないため、この100%という値をAIモデルの精度評価には使用しない。

実API比較では、Providerへ同一の入力を独立して与えた出力を保存し、同じ評価器で比較する。

---

## 6. AI料金ベースライン

2026-08-27時点の各社公式料金から、低コスト候補を比較するための基準値を記録する。

| Candidate | Input / 1M tokens | Output / 1M tokens | 10k input + 1k outputの概算 |
| --- | ---: | ---: | ---: |
| Qwen3.5 Flash | $0.029 | $0.287 | 約$0.000577 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | 約$0.0014 |
| OpenAI GPT-5.4 nano | $0.10 | $0.625 | 約$0.001625 |
| DeepSeek V4 Flash | $0.14 | $0.28 | 約$0.00168 |
| Claude Haiku 4.5 | $1.00 | $5.00 | 約$0.015 |

注意：

- これは精度を考慮しない単純な料金比較である
- 実際の1レシピあたりToken数は実API PoCで計測する
- Qwenはdeployment scope / context長等で料金が変わる
- DeepSeekはcache hit / miss等で料金が変わる
- 各社価格は変更される可能性があるため、採用決定時に再確認する

参考公式ページ：

- https://ai.google.dev/gemini-api/docs/pricing
- https://platform.openai.com/pricing
- https://api-docs.deepseek.com/quick_start/pricing/
- https://www.alibabacloud.com/help/en/model-studio/model-pricing
- https://www.anthropic.com/claude/haiku

---

## 7. 現時点で確定してよいこと

- Webレシピページからレシピ構造化までの基本フロー自体は成立する
- Recipe Schemaと評価基盤を使ってAI Providerを同条件比較できる状態になった
- `servings` は数値だけでなく原文保持が必要
- SNS系URLを一般Webと同じ単純HTML取得方式で一括処理する前提にはしない
- AI Provider / Modelはまだ確定しない

---

## 8. 次に外部環境で実施する項目

- [ ] YouTube Data API等を使い、実動画URLからdescriptionを本番Backend相当の方法で取得する
- [ ] Instagram実投稿URLの取得方式を検証する
- [ ] TikTok実投稿URLの取得方式を検証する
- [ ] Gemini / OpenAI / Qwen / DeepSeekへ同一fixtureを投入する
- [ ] 結果を `evaluate.mjs` で比較する
- [ ] 採用AI Provider / Modelを決定する
- [ ] 採用取得方式 + 採用AIで最終E2Eを通す

上記が完了するまでは `todo.md` の「技術選定・技術検証」全体は未完了とする。
