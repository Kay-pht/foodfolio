# AIモデル比較（PoC候補）

## 1. 目的

foodfolio のレシピ解析に利用するAIモデルについて、APIキー設定・検証コストを増やしすぎないよう、比較対象を **最大4プロバイダー・6モデル** に絞る。

本資料は `docs/technology-selection.md` のAI解析・AI PoC方針を補足する比較資料とする。

比較基準は以下。

- レシピページからの構造化抽出に必要な性能
- APIコスト
- Structured Output / JSON出力への対応
- 応答速度
- Context length
- URL取得等の周辺機能
- APIキー・Provider追加による運用負荷

> 注意: 一般ベンチマークの順位だけでは採用を決定しない。最終判断は、foodfolio の実レシピデータを使ったPoC結果を優先する。

### PoC結論（2026-08-27）

MVPはZ.ai / `glm-5.3-flash`を採用する。固定5 fixtureでJSON / Schema 100%、Hallucination 0件、その他の全基準を達成し、5件の単価換算費用は0.001887米ドルだった。最終E2Eも5実URLを各3回、計15回すべて合格した。

Gemini / `gemini-3.5-flash-lite`はFree Tierで同じ5 fixtureを完走したが、人数範囲を根拠なく平均化したため不合格とした。OpenAI / `gpt-5.6-luna`とDeepSeek / `deepseek-v4-flash`は、Z.ai合格後の追加課金を避けるため実API評価を省略した。詳細は `docs/poc-validation-results.md` を参照する。

## 2. 比較対象

2026-08-27時点の比較候補。

| 順位 | Provider | モデル | Artificial Analysis Intelligence | 速度目安 | API価格 Input / Output（USD / 1M tokens） | 1,000レシピ概算 | 構造化 / URL | 主な強み | foodfolioでの位置づけ |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| **1** | **Z.ai** | **GLM-5.3-Flash** | **57** | 約50 tok/s | **$0.15 / $0.50** | **約$1.25** | JSON / Tools | 高い性能対価格比、1M context、画像入力対応 | **性能・価格比の本命** |
| **2** | **DeepSeek** | **DeepSeek V4 Flash 0731** | **52** | 約125–133 tok/s | **$0.14 / $0.28 を基準に要最新料金確認** | **約$0.98** | JSON Output / Tools | 最安級、高速、1M context、OpenAI互換API | **コスト本命** |
| **3** | **OpenAI** | **GPT-5.6 Luna** | **52** | 約140 tok/s | **$0.20 / $1.20** | **約$2.20** | Structured Outputs | JSON Schemaを使った実装、API成熟度、速度と価格のバランス | **実装安定性の基準候補** |
| **4** | **Google** | **Gemini 3.5 Flash-Lite** | 37 | 約370–380 tok/s | $0.30 / $2.50 | 約$4.00 | Structured Outputs / URL Context | document parsing・simple data extraction向け、URL Context、非常に高速 | **用途特化候補** |
| **5** | **Google** | **Gemini 3.7 Flash** | **56** | 約357 tok/s | $0.75 / $3.75 | 約$7.50 | Structured Outputs / URL Context | 高性能、高速、URL Context、マルチモーダル | **高精度・統合機能候補** |
| **6** | **DeepSeek** | **DeepSeek V4 Pro** | **53** | 約70 tok/s | Provider公式価格をPoC時に再確認 | — | JSON Output / Tools | Flashより上位の精度候補。同じDeepSeek Provider内で切替可能 | **Flash精度不足時の予備** |

### 1,000レシピ概算の前提

比較用に、1レシピあたり以下を仮定する。

- Input: 5,000 tokens
- Output: 1,000 tokens
- キャッシュ割引なし
- 推論トークン等の追加課金は含めない

実際のfoodfolioでのコストは、PoC時に実token使用量を計測して更新する。

## 3. Providerを4社に限定する理由

初期比較対象は以下の4社のみとする。

1. Z.ai
2. DeepSeek
3. OpenAI
4. Google

Tencent、MiniMax、Alibaba Qwen、Mistral、Anthropic等にも有力モデルは存在するが、MVP段階でProviderを増やすと以下の負荷が増える。

- APIキー発行・管理
- Secret Manager設定
- Provider別Adapter実装
- 課金設定
- API仕様差への対応
- PoCケース数の増加

現時点では、上記4社で「低価格」「高性能」「Structured Output」「URL Context」という主要な比較軸を十分にカバーできるため、追加Providerは必要になった場合のみ検討する。

## 4. PoC実施順序

費用を抑えるため6モデルすべては検証せず、Z.aiを先行評価し、Gemini Free Tierを比較した。

1. **Z.ai / GLM-5.3-Flash**を有料候補として先行評価し、全基準への合格を確認した。
2. **Gemini 3.5 Flash-Lite**をFree Tierで同一fixture比較し、URL Contextは別枠の構成として検証した。
3. Z.aiが合格したため、**OpenAI / GPT-5.6 Luna**と**DeepSeek / DeepSeek V4 Flash**への有料リクエストは実行しなかった。
4. 将来、採用モデルが基準を満たさなくなった場合は、同じfixtureと評価器で未実施Providerを比較する。

## 5. PoCで計測する項目

一般ベンチマークではなく、実レシピに対して以下を評価する。

- 料理名一致率
- 基準人数一致率
- 材料名一致率
- 分量一致率
- 単位一致率
- 調理時間一致率
- 調理手順一致率
- 取得不能項目を正しく `null` / 未取得として扱える割合
- 存在しない情報を補完・捏造する割合
- JSON parse成功率
- Schema validation成功率
- Retry発生率
- レスポンスタイム
- Input / Output token数
- 1レシピあたり実コスト

## 6. 採用判断

優先順位は以下とする。

1. 必須項目の抽出精度を満たすこと
2. 捏造率が許容範囲であること
3. Schema validationが安定すること
4. その条件を満たすモデルの中から実コストが低いものを選ぶこと
5. 精度・コスト差が小さい場合は、API・運用が単純なProviderを優先すること

たとえば DeepSeek V4 Flash と GLM-5.3-Flash の抽出精度がほぼ同等なら、より低コストなモデルを優先する。一方、GeminiのURL ContextによってBackend側のURL取得・前処理を大幅に削減できる場合は、token単価だけでなくシステム全体の実装・運用コストも含めて判断する。

## 7. 情報更新方針

AIモデルの価格・提供モデル・ベンチマークは変化が速いため、PoC実施直前に以下を再確認する。

- 各Provider公式API料金
- モデルの提供継続状況
- Context length
- Structured Output / JSON Schema仕様
- Rate limit
- Artificial Analysis等の第三者ベンチマーク

本資料の数値は固定仕様として扱わず、**モデル選定時点の比較スナップショット**として扱う。
