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
- TikTok: oEmbedの `thumbnail_url`
- YouTube: YouTube Data APIのthumbnailを `maxres` → `standard` → `high` → `medium` → `default` の順で選択

一般WebへのHTTPアクセスは既存の `SafeHttpClient` を通し、内部アドレス、危険なredirect、過大response等に対する既存のSSRF制限を再利用する。

YouTube再解決のため、API Cloud RunにもWorkerと同じSecret Manager上の `YOUTUBE_API_KEY` を注入する。新しいAPI keyや外部サービスは追加しない。

## iOS表示と保存

再取得した画像も通常画像と同じ `RecipeImageView` で表示し、`resizable().scaledToFill()` と `clipped()` を適用する。画像の取得経路によってトリミング方法を変えない。

取得済み画像はRecipe ID単位でApplication Supportへ保存する。保存だけに失敗した場合は現在の画面では取得済み画像を表示し、失敗状態は永続化しない。

同一Recipeの同一取得世代に対する複数画面からの要求は既存の `RecipeImageStore` で共有する。Recipe URL変更、Recipe削除、ローカルデータ全削除時には古い取得世代を無効化する。
