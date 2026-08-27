# foodfolio MVP PoC検証結果

## 1. 最終判定

2026-08-27、ローカルNode.js v24.18.0でPoCを実施した。Cloud Runでの確認結果ではない。

その後、YouTubeについては利用規約と公式API仕様を再確認し、MVPの取得方式を **YouTubeページHTMLの自動取得からYouTube Data API v3へ変更**した。

このため、当初のYouTube取得結果とYouTubeを含む実URL E2E結果は、旧方式で実施した履歴として保持するが、現在のYouTube取得方式の実証結果としては扱わない。

| PoC | 判定 | 根拠 |
| --- | --- | --- |
| 外部URL情報取得 | 一部再検証 | YouTube以外は当初PoC結果を維持。YouTubeはData API v3へ切替済みで実URL再実行待ち |
| AIレシピ構造化 | 完了 | Z.ai `glm-5.3-flash`が固定5 fixtureですべての基準を達成 |
| 実URL E2E | 一部再検証 | 当初5実URL×3回は合格したが、YouTube 1 fixtureは旧HTML取得方式だったためData API経路で再実行が必要 |

MVPの標準AI Provider / ModelはZ.ai / `glm-5.3-flash`とする。

URL取得は一般Web・各サービスの公開仕様に沿ったサービス別抽出を採用し、**YouTubeはURLからvideoIdを抽出してYouTube Data API v3 `videos.list(part=snippet)`を呼び出す専用経路**とする。Gemini URL ContextはMVPの共通経路には採用しない。

## 2. PoC 1 — 外部URL情報取得

`npm run poc:url`で、`poc/url-extraction/cases.json`の20件を取得した。

以下は当初PoCの実測結果である。YouTube行のみ、現在は取得実装を変更しているため履歴値として扱う。

| ソース | AI入力可能 | 画像URL | JS依存シグナル | 判定 |
| --- | ---: | ---: | ---: | --- |
| 一般Web | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クラシル | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| クックパッド | 3/3 | 3/3 | 0/3 | MVP利用可能 |
| YouTube | 3/3 | 3/3 | 3/3 | 旧HTML方式での実測値。現行Data API方式は再実行待ち |
| Instagram | 3/3 | 3/3 | 1/3 | MVP利用可能（公開メタデータ範囲） |
| TikTok | 1/3 | 3/3 | 3/3 | 条件付き |

TikTokは実行間でも0/3から1/3へ変動した。公開oEmbedまたはHTMLメタデータに十分なレシピ本文がある投稿だけを扱い、本文不足時は解析不能として返す。

### 2.1 YouTube取得方式の訂正

当初PoCではYouTubeのoEmbedに加えて、ページ内の`ytInitialPlayerResponse.videoDetails.shortDescription`を抽出していた。

この方式は現在の採用方式から除外する。YouTubeページをbot / scraper等の自動手段で取得して内部JSON構造を解析する実装には依存しない。

現行方式は以下とする。

```text
YouTube URL
↓
URL文字列からvideoIdを抽出
↓
YouTube Data API v3
GET https://www.googleapis.com/youtube/v3/videos
  ?part=snippet
  &id=<videoId>
  &key=<YOUTUBE_API_KEY>
↓
snippet.title
snippet.description
snippet.thumbnails
snippet.channelTitle
↓
既存のAI入力形式へ変換
↓
Z.ai
```

公開動画のメタデータ取得ではユーザーのYouTubeログインを要求せず、Backendが保持するAPI keyを使用する。

`videos.list(part=snippet)`は公式仕様上、`title`、`description`、`thumbnails`、`channelId`、`channelTitle`、`tags`、`categoryId`等を取得できる。foodfolioで必要な主要入力は`title`、`description`、`thumbnails`で満たせる。

`videos.list`のquota costは公式仕様上1 requestあたり1 unitである。

API keyは`.env` / Google Cloud Secret Managerで管理し、リポジトリへ実値を保存しない。

Instagramは公開OGメタデータを使用する。認証回避、非公開投稿取得、動画・画像本体の無断ダウンロードは行わない。

負例2件はいずれも当初PoCではAI入力不可と判定した。画像失敗だけでは本文取得を失敗扱いにしない。

当初PoCの証拠：

- `poc/results/url-extraction-summary.json`
- `poc/results/url-source-classification.json`

これらに含まれるYouTube結果は旧HTML方式の履歴であり、Data API方式の再実行後に更新する。

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

YouTube fixtureは当初取得した説明文を固定入力として使用しているため、**LLM自体の抽出精度評価は有効**である。一方、そのfixtureが現行Data API経路から同等に生成されることは再実行で確認する。

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

当初採用構成で次の処理を、5 fixtureそれぞれ3回実行した。

```text
実URL
→ Node.js fetch / サービス別抽出
→ Z.ai glm-5.3-flash
→ JSON parse
→ Recipe Schema validation
→ 精度・Hallucination評価
```

当初は計15回すべてでSchema成功・Hallucination 0件となり、集計値もPoC 2の全合格基準を満たした。

- 成功: 15/15
- 報告token数の単価換算合計: 0.005190米ドル
- 1件平均の単価換算: 0.000346米ドル
- 平均応答時間: 20.0秒
- 安定性判定: 当初構成では合格

ただしYouTube fixtureの3回は旧HTML取得方式を使用している。そのため、現行構成については次の経路を再実行する。

```text
YouTube実URL
→ videoId抽出
→ YouTube Data API v3 videos.list(part=snippet)
→ AI入力生成
→ Z.ai glm-5.3-flash
→ Schema validation
```

再実行では少なくとも以下を確認する。

- `snippet.title` / `snippet.description` / `snippet.thumbnails`が必要情報を満たすこと
- 対象YouTube fixtureがAI入力可能と判定されること
- Z.ai出力のSchema / Hallucination基準を維持すること
- Data API取得時間を記録すること

Googleは`videos.list`の応答時間保証を公開していないため、**取得時間が旧方式と同等以上であるとは実測前に断定しない**。ただし現行実装はYouTubeページHTML + oEmbed + HTML内部JSON解析ではなく、Data APIのJSON request 1回となる。

証拠：`poc/results/e2e-results.json`（YouTubeについては旧方式の履歴）

## 5. 採用結論

- AI Provider: Z.ai
- Model: `glm-5.3-flash`
- 一般URL取得: Node.js `fetch` + JSON-LD / OGP / 必要な公開メタデータ
- YouTube取得: YouTube Data API v3 `videos.list(part=snippet&id=...)`
- YouTube認証: 公開動画メタデータはBackendのAPI keyを使用。ユーザーOAuthは要求しない
- YouTube Secret: `YOUTUBE_API_KEY`をSecret Managerで管理
- YouTube HTMLの`ytInitialPlayerResponse`抽出: 不採用
- TikTok: 条件付き対応
- Gemini URL Context: 補助検証結果として保持し、MVP共通経路には不採用
- Validation: BackendでRecipe Schema validationを必須化
- Provider adapter: 将来の再比較用に維持

今回の当初PoC結果はローカルNode.jsで確認済みであり、Cloud Runで確認済みとは表現しない。

YouTube Data API経路の機能・E2E・取得時間については、`YOUTUBE_API_KEY`を設定したうえで再実行した結果を追記するまでは「実測済み」と表現しない。

## 6. YouTube関連の一次資料

- YouTube Terms of Service  
  https://www.youtube.com/static?template=terms
- YouTube Data API — Videos: list  
  https://developers.google.com/youtube/v3/docs/videos/list
- YouTube Data API — Video resource / snippet  
  https://developers.google.com/youtube/v3/docs/videos
- YouTube Data API — API request authentication  
  https://developers.google.com/youtube/v3/docs
