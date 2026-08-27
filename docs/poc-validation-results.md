# foodfolio MVP PoC検証結果

## 1. 本書の位置づけ

`docs/poc-validation-plan.md` に基づくPoCの実施結果を記録する。

本書では、**本番または本番相当の実行経路で再現できた結果だけをPoC完了の根拠として扱う。**

以下はPoC成功の証拠として扱わない。

- ChatGPTのWeb検索・ブラウジング機能を介して取得したページ内容
- ChatGPT会話内で生成したAI抽出結果
- 検索インデックスや独自のページ解析経路を介した取得結果
- 本番Backendと異なるネットワーク経路だけで確認した結果

これらは検証対象や実装候補を考えるための参考情報としてのみ利用する。

PoC完了判定には、例えば以下のような再現可能な証拠を要求する。

- Node.js / `fetch` 等、本番Backendで採用予定のHTTPクライアントからの直接取得結果
- 採用候補の公式APIを実APIキーで呼び出した結果
- 実際のProvider APIから返されたレスポンス
- 同一fixture・同一評価器を用いた再実行可能な比較結果

---

## 2. 進捗サマリー

### PoC 1 — 外部URL情報取得

現時点で、PoC完了として認められる取得検証はまだない。

- [ ] 本番Backend相当のHTTP実行環境で一般Webを取得検証
- [ ] 本番Backend相当のHTTP実行環境でクラシルを取得検証
- [ ] 本番Backend相当のHTTP実行環境でクックパッドを取得検証
- [ ] YouTubeの本番取得方式を実検証
- [ ] Instagramの実投稿URLで取得方式を実検証
- [ ] TikTokの実投稿URLで取得方式を実検証
- [ ] 各対象サービスを「MVP利用可能 / 条件付き / 非対応」に最終分類

### PoC 2 — AIレシピ構造化

PoC実施のための準備物として以下は作成済み。

- [x] foodfolio用の暫定 `ExtractedRecipe` JSON Schemaを作成
- [x] AI評価スクリプトを作成
- [x] AI候補の公式料金を再確認し、比較用の料金ベースラインを作成

以下は未完了。

- [ ] 本番相当のURL取得結果を元に比較用fixtureを確定
- [ ] Gemini実APIで同一fixtureを実行
- [ ] OpenAI実APIで同一fixtureを実行
- [ ] Qwen実APIで同一fixtureを実行
- [ ] DeepSeek実APIで同一fixtureを実行
- [ ] 必要に応じてClaude実APIで同一fixtureを実行
- [ ] Provider / Modelを精度・hallucination・Schema成功率・コストで比較
- [ ] MVP採用Provider / Modelを確定

### PoC 3 — URL取得からAI解析までの統合確認

現時点では未完了。

- [ ] PoC 1で確定した本番候補のURL取得方式からAI入力テキストを生成
- [ ] 採用AI Provider / Modelの実APIへ入力
- [ ] 実API出力をSchema validation
- [ ] MVP主要ソースで最終E2E確認

---

## 3. ChatGPT内で行った確認の扱い

ChatGPTのWeb取得機能を用いて、一般Web、クラシル、クックパッド、YouTube等のページ上にレシピ情報が存在することは参考として確認した。

ただし、この取得経路は本番Backendで予定している次の経路とは異なる。

```text
Cloud Run / Node.js
↓
HTTP client (`fetch` 等)
↓
対象URLまたは公式API
↓
実レスポンス
```

そのため、これらの確認結果から以下を断定しない。

- Cloud Runから同じHTML / データを取得できる
- CookieやJavaScript実行なしで取得できる
- Bot対策やアクセス制限に阻まれない
- 同じ方法で継続的に取得できる
- MVP正式対応可能である

以前の文書で「取得成功」「E2E成功」と表現していたチャット内確認は、**参考観察へ訂正し、PoC完了判定から除外する。**

---

## 4. Recipe Schema

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

Schemaの作成自体は完了している。

ただし、実データに対して十分かどうかは本番相当のURL取得PoCおよびAI実API比較を通して再評価する。

`servings.raw` は、人数が単一数値に正規化できないケースを保持できるようにするための暫定設計である。

正式なDBモデルは実装設計で確定する。

---

## 5. AI評価基盤

作成ファイル：

- `poc/ai-extraction/evaluate.mjs`

評価スクリプトでは現時点で以下を確認できる。

- 必須フィールドの構造チェック
- title一致
- servings数値一致
- cooking time一致
- ingredient precision
- ingredient recall
- ingredient amount完全一致率
- step件数

評価スクリプトの作成自体は完了している。

### 5.1 既存のChatGPT baselineについて

`chatgpt-baseline.json` を使った実行は、**評価スクリプトが動作することを確認するための自己テスト**としてのみ扱う。

これは以下の理由からAIモデル精度のPoC結果には含めない。

- 入力取得が本番相当経路ではない
- ChatGPT会話内で内容を確認しながらbaselineを作成している
- 実Provider APIを独立に呼び出した結果ではない

したがって、過去に得られた100%等の値はProvider選定には使用しない。

---

## 6. AI料金ベースライン

AI候補の公式料金を比較するための基準値は、各Providerの公式料金情報を元に作成した。

これは技術性能PoCではなく、**価格調査結果**として有効とする。

実際の1レシピあたりコストは、実API PoCで入力Token / 出力Tokenを計測して確定する。

採用決定時には各社公式料金を再確認する。

---

## 7. 現時点で完了と認めるもの

以下のみ完了扱いとする。

- PoC検証計画書の作成
- Recipe Schemaの作成
- AI評価スクリプトの作成
- 公式情報に基づくAI料金ベースライン調査

これらはPoCを実施するための準備成果物であり、**URL取得・AI精度・E2E成立を証明したものではない。**

---

## 8. 現時点で未確定の事項

- 一般Webの本番相当取得方式と成功率
- クラシルの本番相当取得方式と成功率
- クックパッドの本番相当取得方式と成功率
- YouTubeの本番取得方式
- Instagramの取得方式
- TikTokの取得方式
- MVP正式対応URLソース
- AI Provider
- AI Model
- AI実APIでの抽出精度
- hallucination水準
- 実際の1レシピあたりAIコスト
- URL取得 → AI解析 → Schema validationの最終E2E成立

---

## 9. 次に実施する項目

- [ ] 本番Backend相当のNode.js HTTP実行環境から対象URLを直接取得する
- [ ] 必要なサービスは公式API等の本番候補方式を実際に呼び出す
- [ ] その取得結果を保存し、AI比較fixtureを確定する
- [ ] Gemini / OpenAI / Qwen / DeepSeekへ同一fixtureを実API投入する
- [ ] 結果を `evaluate.mjs` で比較する
- [ ] 採用AI Provider / Modelを決定する
- [ ] 採用取得方式 + 採用AIで最終E2Eを通す

上記が完了するまでは `todo.md` の `poc` は未完了とする。
