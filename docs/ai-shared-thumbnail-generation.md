# AI共有レシピの生成サムネイル設計

## 目的

ChatGPT / Gemini の公開共有会話から取り込んだレシピは、元ページにレシピ代表画像がないため `Recipe.imageUrl` が `null` になる。本機能では、レシピ抽出後に機械的に成立しているレシピだけを対象として完成料理のサムネイルを1枚生成し、既存の `imageUrl` 表示経路へ載せる。

## 対象

対象は新規解析される `sourceType = chatgpt | gemini` の Recipe のみとする。既存保存済みRecipeへのバックフィル、Web / YouTube / Instagram / TikTok等への生成画像fallbackは行わない。

画像生成条件は次のすべてを満たす場合とする。

- `sourceType` が `chatgpt` または `gemini`
- 元の `SourceContent.imageUrl` が `null`
- Z.ai等の既存レシピ抽出処理が成功している
- 既存のレシピ成立判定で `ingredients.length > 0 && steps.length > 0`
- Workerに `OPENAI_API_KEY` と `GENERATED_RECIPE_IMAGE_BUCKET` が設定されている

## 処理フロー

```text
ChatGPT / Gemini 公開共有URL
        ↓
既存の共有会話取得・正規化
        ↓
既存RecipeExtractor（通常はZ.ai）
        ↓
構造化済みRecipe
        ↓
抽出済みRecipe fieldsを保存
analysisStatus = processing のまま維持
processingRunId / lease も維持
        ↓
ingredients > 0 && steps > 0 ?
        ├─ No → 画像生成なし
        └─ Yes
             ↓
OpenAI Image API
  model: gpt-image-2.5-flare
  size: 1024x1024
  quality: low
  output: WebP
  deadline: 45秒
             ↓
成功時のみ専用GCS bucketへ永続保存
             ↓
所有権付き最終更新
  imageUrl = 生成URL または null
  analysisStatus = completed
  processingRunId = null
  processingLeaseExpiresAt = null
```

画像生成の成否が確定するまで `analysisStatus = processing` を維持する。iOSは `pending` / `processing` のRecipeをポーリングするため、`completed` を公開した時点で最終的な `imageUrl` も確定している状態にする。

抽出済みの材料・手順等は画像生成前にDBへ保存してよい。ただし、OpenAI / GCSのbest-effort処理を終える前に `completed` へ遷移させない。

## OpenAIへ送る内容

画像生成には共有会話全文を送らない。RecipeExtractorが返した構造化済みデータのうち、次だけから固定promptを構成する。

- title
- ingredients
- steps

Foodfolioの `User.id`、Firebase UID、メールアドレス、認証Token、端末Token等を送らない。構造化済みRecipeの文字列もuntrusted dataとして扱い、フィールド内の指示文を画像生成指示として採用しないよう固定promptで明示する。

画像promptは、完成料理を中心とした自然な料理写真、人物・手・ロゴ・文字なし、レシピにない主要食材を勝手に追加しない、という制約を持つ。

## deadline

OpenAI画像生成には45秒のアプリケーションdeadlineを設定する。Worker全体のCloud Run request timeout 600秒より十分短い上限とし、画像生成だけで解析全体を長時間占有しない。

deadline到達時はOpenAI requestをabortし、通常のbest-effort画像生成失敗として扱う。レシピ抽出結果自体は失敗にしない。

## 失敗時の扱い

画像生成はbest-effortとする。

- OpenAI失敗 → `imageUrl = null` でcompletedへ最終化
- OpenAI deadline到達 → 同上
- OpenAIレスポンスに画像がない → 同上
- GCS保存失敗 → 同上
- 生成画像保存後にRecipeが削除済み → Recipe ID配下の生成画像を削除
- 生成画像保存後の最終DB更新が失敗 → 生成画像を削除し、DB永続化失敗として既存の解析retry経路へ戻す

通常ログへprompt、共有会話、OpenAIレスポンスbody、API keyを出さない。失敗ログは固定error codeとerror名を中心に残す。

## 永続ストレージ

一時メディア用bucketとは分離し、生成サムネイル専用の永続Google Cloud Storage bucketを使用する。

object名は次の形式とする。

```text
recipe-images/{recipeId}/{randomUUID}.webp
```

User IDはobject名へ含めない。URL推測を困難にするためランダムUUIDを含める。

bucketはuniform bucket-level accessを使用する。public accessは既知object URLからのGETに必要な `storage.objects.get` のみに限定し、publicなobject list権限は付与しない。WorkerとAPI service accountには生成・削除のためobject管理権限を付与する。

## 削除

生成画像はRecipe所有データとして扱う。

### Recipe削除

`DELETE /v1/recipes/:recipeId` では、`imageUrl` がFoodfolio生成画像bucketのURLである場合、対象Recipe ID prefixのobjectを先に削除してからDB Recipeを削除する。

生成画像削除に失敗した場合は503を返し、DB Recipeを残して再試行可能にする。外部サイト由来の `imageUrl` は削除対象にしない。

### アカウント削除

`DELETE /v1/me` でも、所有RecipeのFoodfolio生成画像をDBのcascade deleteより前に削除する。生成画像の削除に失敗した場合はDB Userを削除せず503とする。

## iOSとの互換性

生成成功後は既存と同じ `Recipe.imageUrl` にHTTPS URLが入るため、iOS側の `RecipeImageLoader` / `RecipeImageStore` は変更しない。端末は既存どおり `imageUrl` を直接取得してApplication Supportへキャッシュする。

解析中は既存どおり `pending` / `processing` としてポーリング対象に残る。画像生成の成功・失敗・deadline到達のいずれかが確定した後に `completed` へ遷移するため、ポーリング終了時には最終的な `imageUrl` も確定している。

AI共有リンク向けの `/v1/recipes/:recipeId/image/resolve` は、生成画像の再生成APIにはしない。通常は保存済み `imageUrl` が先に利用される。生成画像が将来欠損した場合の再生成は別仕様とする。

## 設定

- `OPENAI_API_KEY`: OpenAI Image API用。Workerのみが利用する
- `OPENAI_IMAGE_MODEL`: 既定 `gpt-image-2.5-flare`
- `GENERATED_RECIPE_IMAGE_BUCKET`: 生成画像の永続保存bucket。WorkerとAPIが利用する

OpenAI設定がないローカル環境では画像生成機能だけを無効化し、既存のレシピ解析は動作させる。
