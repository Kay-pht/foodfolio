# レシピ画像の再取得設計

この文書を、保存済みレシピの代表画像が端末から失われた場合の再取得フローの正本とする。`docs/implementation-design.md` 25.7 に残る `LPMetadataProvider` を使った再取得記述より本書を優先し、25.7 の画像保存・キャッシュ保持に関するその他のルールは引き続き有効とする。

## 目的

初回解析時と画像再取得時で代表画像の決定方法を分岐させず、動画プレビュー用の再生ボタン等が含まれた別画像へ置き換わることを防ぐ。

## 再取得フロー

```text
Application Support に有効なローカル画像あり
→ そのまま表示

ローカル画像なし / decode不可
→ 保存済み imageUrl をiOSから直接取得
→ 成功したら端末へ保存して表示

保存済み imageUrl が失効・取得不可
→ POST /v1/recipes/:recipeId/image/resolve
→ Backendが初回解析と同じ ProductionSourceContentExtractor で originalUrl を再解決
→ 新しい代表 imageUrl があればiOSへ返す
→ iOSがその画像URLを直接取得
→ Application Supportへ保存して表示

Backendでも代表画像を解決できない / 画像取得に失敗
→ placeholder
→ 次回の画面表示時に再試行
```

Backendの再解決APIは認証済みユーザーが所有するRecipeだけを対象にする。再解決結果は端末側キャッシュ復旧のために返し、RecipeのServer管理 `imageUrl` 自体はこのAPIでは更新しない。

## 初回解析との共通化

再解決ではWorkerの初回解析と同じ `ProductionSourceContentExtractor` を利用する。

- 一般Web / Instagram: OGP / Twitter Cardの代表画像
- TikTok動画: oEmbedの `thumbnail_url`。欠落時だけ投稿ページを `SafeHttpClient` で取得し、`__UNIVERSAL_DATA_FOR_REHYDRATION__` の `__DEFAULT_SCOPE__` → `webapp.video-detail` → `itemInfo.itemStruct.video` にある `cover` → `originCover` の順でHTTPS画像URLを選ぶ。最終URLがTikTok動画であり、ページ内の投稿IDと一致すること、入力URLの投稿IDおよびoEmbedの `embed_product_id` が存在する場合はそれらとも一致することを確認する。取得拒否・JSON不正・不一致・画像なしの場合は画像なしを維持し、レシピ本文の解析を妨げない
- TikTok写真: 既存の写真メタデータから先頭の画像URL
- YouTube: YouTube Data APIのthumbnailを `maxres` → `standard` → `high` → `medium` → `default` の順で選択

一般WebへのHTTPアクセスは既存の `SafeHttpClient` を通し、内部アドレス、危険なredirect、過大response等に対する既存のSSRF制限を再利用する。

YouTube再解決のため、API Cloud RunにもWorkerと同じSecret Manager上の `YOUTUBE_API_KEY` を注入する。新しいAPI keyや外部サービスは追加しない。

## iOS表示と保存

再取得した画像も通常画像と同じ `RecipeImageView` で表示し、`resizable().scaledToFill()` と `clipped()` を適用する。画像の取得経路によってトリミング方法を変えない。

取得済み画像はRecipe ID単位でApplication Supportへ保存する。保存だけに失敗した場合は現在の画面では取得済み画像を表示し、失敗状態は永続化しない。

同一Recipeの同一取得世代に対する複数画面からの要求は既存の `RecipeImageStore` で共有する。Recipe URL変更、Recipe削除、ローカルデータ全削除時には古い取得世代を無効化する。

## 2026-10-24 TikTok動画2件の調査

対象は `https://vt.tiktok.com/ZSgHLdvHd/`（`@tamu.recipe/video/7646381901225184533`）と `https://vt.tiktok.com/ZSgH8cXso/`（`@maki.recipe/video/7640445938049305877`）。

- 両方のoEmbed実応答はHTTP 200で、動画iframeと `embed_product_id` を含む一方、`thumbnail_url` と `title` を含まなかった。canonical URLへ置き換えたoEmbed要求でも欠落していた。
- 修正前の `ProductionSourceContentExtractor` と `SafeHttpClient` を実URLへ実行し、両方で `imageUrl: null` / `textForAi: null` を再現した。材料・作り方は動画解析経路で取得可能だが、その結果から画像を補完する処理はなかった。解析成功時のWorkerは `source.imageUrl` を保存するため、本文が正常でも画像だけ欠落する。
- 画像再取得APIも同じextractorを呼ぶため、oEmbedに画像がない間は繰り返しても `null` となる。iOSは再取得URLがない場合にplaceholderを表示する。
- 稼働APIが参照するDBを `BEGIN READ ONLY` で照会し、2件目の投稿IDに一致する保存済みRecipeが `completed` / `imageUrl: null` / provider `zai` / 材料10件 / 手順8件であることを確認した。Cloud Runログでも同Recipeへの画像再取得API呼び出しが繰り返しHTTP 200で終了していた。1件目は短縮URL・投稿IDで一致するDB行を照会時点で見つけられなかったため、その保存状態は未確認。両URLの抽出失敗と修正後の画像取得は実URLで直接再現済み。
- 投稿ページのJSON hydrationには、両方とも対象投稿IDと `video.cover` / `video.originCover` が存在した。修正後の同じextractorとSafeHttpClientで両実URLを実行し、画像URLの取得とJPEGダウンロードを確認した。順にHTTP 200 / `image/jpeg` / 126,037 bytes、HTTP 200 / `image/jpeg` / 108,880 bytesだった。
- Player metadata APIも調べたが両方HTTP 403だったため、今回の補完には使用しない。追加の有料AI呼び出しは行っていない。

再現用データは `tests/fixtures/tiktok-thumbnail/` に保存する。oEmbedは取得した応答、HTMLは投稿IDと動画カバーの構造だけを残した最小fixtureで、署名付きCDN URLは `images.example` に置き換える。回帰テストは修正前に画像が `null` となる5件の失敗を確認してから実装した。

この確認は保存データの読み取りとローカルコード・外部サービス実応答による再現であり、保存済みRecipeの変更、Cloud Runへのデプロイ、利用者端末での復旧確認は含まない。反映にはAPIとWorkerのデプロイが必要。既存レシピはAPI反映後の通常の画像再取得で復旧する設計であり、レシピ再解析やDB更新を必要としない。
