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
ingredients > 0 && steps > 0 ?
        ├─ No → 画像生成なし
        └─ Yes
             ↓
Recipe本体をcompletedで保存
             ↓
OpenAI Image API
  model: gpt-image-2.5-flare
  size: 1024x1024
  quality: low
  output: WebP
             ↓
専用GCS bucketへ永続保存
             ↓
Recipe.imageUrlをpublic HTTPS URLへ更新
```

Recipe本体の保存を画像生成より先に確定する。OpenAIやGCSの一時障害によって、既に成功したレシピ解析を `failed` や再試行状態へ戻さない。

## OpenAIへ送る内容

画像生成には共有会話全文を送らない。RecipeExtractorが返した構造化済みデータのうち、次だけから固定promptを構成する。

- title
- ingredients
- steps

Foodfolioの `User.id`、Firebase UID、メールアドレス、認証Token、端末Token等を送らない。構造化済みRecipeの文字列もuntrusted dataとして扱い、フィールド内の指示文を画像生成指示として採用しないよう固定promptで明示する。

画像promptは、完成料理を中心とした自然な料理写真、人物・手・ロゴ・文字なし、レシピにない主要食材を勝手に追加しない、という制約を持つ。

## 失敗時の扱い

画像生成はbest-effortとする。

- OpenAI失敗 → Recipeはcompletedのまま、`imageUrl` は `null`
- OpenAIレスポンスに画像がない → 同上
- GCS保存失敗 → 同上
- 生成画像保存後にRecipeが削除済み → Recipe ID配下の生成画像を削除
- `Recipe.imageUrl` 更新失敗 → 生成画像を削除し、Recipe本体はcompletedのまま維持

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

AI共有リンク向けの `/v1/recipes/:recipeId/image/resolve` は、生成画像の再生成APIにはしない。通常は保存済み `imageUrl` が先に利用される。生成画像が将来欠損した場合の再生成は別仕様とする。

## 設定

- `OPENAI_API_KEY`: OpenAI Image API用。Workerのみが利用する
- `OPENAI_IMAGE_MODEL`: 既定 `gpt-image-2.5-flare`
- `GENERATED_RECIPE_IMAGE_BUCKET`: 生成画像の永続保存bucket。WorkerとAPIが利用する

OpenAI設定がないローカル環境では画像生成機能だけを無効化し、既存のレシピ解析は動作させる。
