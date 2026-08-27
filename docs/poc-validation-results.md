# foodfolio MVP PoC検証結果

## 1. 最終判定

2026-08-27、ローカルNode.js v24.18.0でPoCを実施した。Cloud Runでの確認結果ではない。

| PoC | 判定 | 根拠 |
| --- | --- | --- |
| 外部URL情報取得 | 完了 | 6ソース各3件と負例2件、合計20件を直接取得 |
| AIレシピ構造化 | 完了 | Z.ai `glm-5.3-flash`が固定5 fixtureですべての基準を達成 |
| 実URL E2E | 完了 | 5実URL×3回、計15回すべて合格 |

MVPの標準AI Provider / ModelはZ.ai / `glm-5.3-flash`とする。URL取得はローカルNode.jsで実証したサービス別抽出を採用し、Gemini URL ContextはMVPの共通経路には採用しない。

## 2. PoC 1 — 外部URL情報取得

`npm run poc:url`で、`poc/url-extraction/cases.json`の20件を同じNode.js `fetch`実装から取得した。

| ソース | AI入力可能 | 画像URL | JS依存シグナル | 判定 |
| --- | ---: | ---: | ---: | --- |
| 一般Web | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クラシル | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クックパッド | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| YouTube | 3/3 | 3/3 | 3/3 | MVP利用可能（サービス別抽出） |
| Instagram | 3/3 | 3/3 | 1/3 | MVP利用可能（公開メタデータ範囲） |
| TikTok | 1/3 | 3/3 | 3/3 | 条件付き |

TikTokは実行間でも0/3から1/3へ変動した。公開oEmbedまたはHTMLメタデータに十分なレシピ本文がある投稿だけを扱い、本文不足時は解析不能として返す。

YouTubeはoEmbedに加えて、ページ内の`ytInitialPlayerResponse.videoDetails.shortDescription`を抽出する。Instagramは公開OGメタデータを使用する。認証回避、非公開投稿取得、動画・画像本体の無断ダウンロードは行わない。

負例2件はいずれもAI入力不可と判定した。画像失敗だけでは本文取得を失敗扱いにしない。

証拠：

- `poc/results/url-extraction-summary.json`
- `poc/results/url-source-classification.json`

## 3. PoC 2 — AIレシピ構造化

### 3.1 評価条件

一般Web、クラシル、クックパッド、YouTube、Instagramの固定5 fixtureを使用した。全モデルへ同じ抽出テキストとRecipe Schemaを渡した。

合格基準：

- JSON parse / Schema成功率: 100%
- Hallucination: 0件
- 材料precision / recall: 各90%以上
- 分量完全一致率: 85%以上
- 料理名、人数、調理時間、ジャンル: 各90%以上
- 手順precision / recall: 各90%以上
- 最終候補は各fixture 3回
- API費用上限: 5米ドル

期待値はAIへ実際に渡す抽出テキストと照合した。材料グループ記号や、要約された重要操作と詳細手順の一対多関係を誤ってHallucinationにしない評価を使用する。

### 3.2 Z.ai先行評価

ユーザーの費用方針に従い、最初にZ.aiだけを評価した。

| 指標 | `glm-5.3-flash` | 基準 | 判定 |
| --- | ---: | ---: | --- |
| JSON parse | 100% | 100% | 合格 |
| Schema | 100% | 100% | 合格 |
| 料理名 | 100% | 90%以上 | 合格 |
| 人数 | 100% | 90%以上 | 合格 |
| 調理時間 | 100% | 90%以上 | 合格 |
| ジャンル | 100% | 90%以上 | 合格 |
| 材料precision | 100% | 90%以上 | 合格 |
| 材料recall | 97.73% | 90%以上 | 合格 |
| 分量完全一致 | 95.35% | 85%以上 | 合格 |
| 手順precision | 100% | 90%以上 | 合格 |
| 手順recall | 96.88% | 90%以上 | 合格 |
| Hallucination | 0件 | 0件 | 合格 |

報告token数を公式単価で換算した5件合計は0.001887米ドル、平均応答時間は18.6秒だった。

証拠：`poc/results/ai-comparison-zai-results.json`

### 3.3 Gemini 3.5 Flash-Lite Free Tier比較

ユーザー指示によりGemini Free Tierを同じ5 fixtureで実行した。5件すべて応答し、Quota制限には達しなかった。

JSON / Schemaは100%だったが、クックパッドの「1〜2人分」を根拠なく`1.5`へ平均化した。このため人数一致率80%、Hallucination 1件となり、合格基準を満たさなかった。

API usageを有料標準単価へ換算した参考値は5件合計0.006840米ドル、平均応答時間は1.85秒である。APIレスポンスからFree Tierの実請求額は確認できないため、この値を実費とは扱わない。

証拠：`poc/results/ai-comparison-gemini-results.json`

### 3.4 他Providerの要否

OpenAIとDeepSeekは追加検証しない。

理由：

- Z.aiが精度・Schema・Hallucination・費用の全基準を満たした
- Gemini Free Tierとの比較でもZ.aiだけがHallucination 0件だった
- 追加Providerの有料評価をしてもMVP成立性の未確定事項は解消されない
- Provider adapterを維持しているため、将来Z.aiが基準を満たさなくなった場合に追加比較できる

### 3.5 Gemini URL Context別枠検証

Gemini 3.5 Flash-LiteのURL Contextを、Backend抽出を省略する別システム構成として4 URLで実行した。

| URL種別 | 取得結果 |
| --- | --- |
| 一般Web（キッコーマン） | 成功 |
| クラシル | 成功 |
| クックパッド | `URL_RETRIEVAL_STATUS_ERROR` |
| Instagram | `URL_RETRIEVAL_STATUS_ERROR` |

取得成功率は2/4であり、共通取得経路にはできない。YouTubeは[Gemini公式仕様](https://ai.google.dev/gemini-api/docs/generate-content/url-context)でURL Context非対応である。

有料標準単価換算の参考値は0.005077米ドル。Free Tierの実請求額はAPIレスポンスから確認できない。

証拠：`poc/results/gemini-url-context-results.json`

## 4. PoC 3 — 実URL E2E

採用構成で次の処理を、5 fixtureそれぞれ3回実行した。

```text
実URL
→ Node.js fetch / サービス別抽出
→ Z.ai glm-5.3-flash
→ JSON parse
→ Recipe Schema validation
→ 精度・Hallucination評価
```

計15回すべてでSchema成功・Hallucination 0件となり、集計値もPoC 2の全合格基準を満たした。

- 成功: 15/15
- 報告token数の単価換算合計: 0.005190米ドル
- 1件平均の単価換算: 0.000346米ドル
- 平均応答時間: 20.0秒
- 安定性判定: 合格

証拠：`poc/results/e2e-results.json`

## 5. 採用結論

- AI Provider: Z.ai
- Model: `glm-5.3-flash`
- URL取得: Node.js `fetch` + JSON-LD / OGP / oEmbed / YouTube player response
- TikTok: 条件付き対応
- Gemini URL Context: 補助検証結果として保持し、MVP共通経路には不採用
- Validation: BackendでRecipe Schema validationを必須化
- Provider adapter: 将来の再比較用に維持

今回の結果はローカルNode.jsで確認済みであり、Cloud Runで確認済みとは表現しない。
