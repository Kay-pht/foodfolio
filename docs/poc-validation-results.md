# foodfolio MVP PoC検証結果

## 1. 判定サマリー

実施日時は2026-08-27、実行環境はローカルNode.js v24.18.0である。Cloud Runでの確認結果ではない。

| PoC | 現在の判定 | 根拠 |
| --- | --- | --- |
| 外部URL情報取得 | 完了 | 6ソース各3件と負例2件、合計20件をNode.js `fetch`で直接取得 |
| AIレシピ構造化 | 未完了 | 4社すべてが課金残高不足を返し、モデル出力を取得できなかった |
| 実URL E2E | 未完了 | 採用Provider / Modelを選定できていないため未実行 |

PoC全体は未完了である。APIキーは4社とも設定済みで、各ProviderのAPI endpointへ到達したが、利用残高の補充が必要である。

## 2. PoC 1 — 外部URL情報取得

### 2.1 実行方法

`npm run poc:url`で、`poc/url-extraction/cases.json`の20件を同じローカルNode.js処理から取得した。

- 一般Web、クラシル、クックパッド、YouTube、Instagram、TikTokを各3件
- 非レシピ負例を2件
- HTML全文と本文全文は`poc/artifacts/`配下へ保存しない
- AI入力を含むローカル証拠はgitignore対象の`poc/artifacts/`へ保存
- Git対象にはURL、取得日時、HTTP結果、抽出済み情報、ハッシュ、判定だけを保存

### 2.2 サービス判定

最新の機械可読結果は`poc/results/url-source-classification.json`に保存した。

| ソース | AI入力可能 | 画像URL | JS依存シグナル | 判定 |
| --- | ---: | ---: | ---: | --- |
| 一般Web | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クラシル | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クックパッド | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| YouTube | 3/3 | 3/3 | 3/3 | MVP利用可能（サービス別抽出） |
| Instagram | 3/3 | 3/3 | 1/3 | MVP利用可能（公開メタデータ範囲） |
| TikTok | 1/3 | 3/3 | 3/3 | 条件付き |

TikTokは再実行間でも0/3から1/3へ変動した。公開oEmbedまたはHTMLメタデータに十分なレシピ本文が含まれる投稿だけを扱い、本文不足時は解析不能として返す必要がある。

YouTubeはoEmbedだけでは説明文が短いため、ページ内の`ytInitialPlayerResponse.videoDetails.shortDescription`を抽出する。Instagramは公開OGメタデータに投稿本文が含まれるケースを使用する。認証回避、非公開投稿取得、動画・画像本体の無断ダウンロードは実装していない。

負例2件はいずれもAI入力不可と判定できた。画像取得失敗だけでは本文取得を失敗扱いにしない。

## 3. PoC 2 — AIレシピ構造化

### 3.1 固定比較条件

以下の5 fixtureを全Providerへ同一テキスト・同一Schemaで1回ずつ渡す構成を実装した。

- 一般Web
- クラシル
- クックパッド
- YouTube
- Instagram由来の短文・ノイズを含む投稿

比較対象は次の4モデルで固定した。

| Provider | Model ID | Structured Output方式 |
| --- | --- | --- |
| Gemini | `gemini-3.5-flash-lite` | JSON Schema |
| OpenAI | `gpt-5.6-luna` | Responses API JSON Schema |
| Z.ai | `glm-5.3-flash` | Chat Completions JSON mode + Schema prompt |
| DeepSeek | `deepseek-v4-flash` | Responses API JSON Schema |

公式仕様：

- [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Z.ai GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- [DeepSeek API](https://api-docs.deepseek.com/)

Gemini URL Contextは同一抽出テキストのモデル比較とは分け、システム構成比較として扱う。

### 3.2 合格基準

- JSON parse成功率: 100%
- Schema成功率: 100%
- Hallucination: 0件
- 材料precision / recall: 各90%以上
- 分量完全一致率: 85%以上
- 料理名、人数、調理時間、ジャンル: 原典に存在する対象の各90%以上
- 手順の重要操作precision / recall: 各90%以上
- 第1段階は各fixture 1回、最終候補は各fixture 3回
- 有料API総額上限: 5米ドル

### 3.3 実API実行結果

保守的な事前費用見積りは0.1368米ドルで、上限5米ドル未満だった。実際の呼び出し結果は次の通り。

| Provider | HTTP | Provider応答 | モデル出力 | 課金見積り |
| --- | ---: | --- | --- | ---: |
| Gemini | 429 | prepayment credits depleted | なし | $0 |
| OpenAI | 429 | no credits remaining | なし | $0 |
| Z.ai | 429 | insufficient balance / no resource package | なし | $0 |
| DeepSeek | 402 | insufficient balance | なし | $0 |

同じ残高エラーを繰り返さないよう、Providerごとの最初の残高エラー後は残りfixtureを自動skipする。結果は`poc/results/ai-comparison-results.json`へ保存した。

残高不足はモデル精度の不合格ではなく、検証未実施である。そのためProvider / Modelは未選定のままとする。

## 4. PoC 3 — 実URL E2E

実URL取得、同一Provider adapter、JSON parse、Schema validation、評価までのpipelineとローカルE2Eテストは実装済みである。

実Provider E2Eは、PoC 2で全基準を満たした最安候補を選定してから、5 fixtureを各3回実行する。現在は候補未選定のため`npm run poc:e2e`が明示的に停止する。

これはローカルpipelineテストの成功であり、実Provider E2E成功とは扱わない。

## 5. 再開条件とコマンド

4社の課金残高を補充後、次の順で再開する。

```bash
npm run poc:ai
npm run poc:e2e
npm run verify
```

AI比較で1社以上が全合格基準を満たし、選定候補の3回反復E2Eも同じ基準を満たした後にだけ、`todo.md`のPoCを完了へ更新する。
