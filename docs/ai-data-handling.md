# AI解析におけるデータ送信方針

最終更新日: 2026-09-24

## 1. 結論

Foodfolioの現行コードでは、TypeSafe / Jevへ判定用textを送るsemantic routingをZ.ai / Google Gemini等の解析経路の前段に置く。Z.ai / Google Geminiへレシピ解析を依頼し、ChatGPT / Geminiの公開共有レシピでは条件を満たす場合にOpenAIへ代表サムネイル生成を依頼する。いずれのAI Providerへのrequestにも、Foodfolioの利用者を識別するためのアカウント情報を含めない。

そのため、FoodfolioではAI利用そのものを理由とした専用の同意状態、同意API、同意撤回、同意を前提としたアプリ利用制限を持たない。AI Providerの利用と送信対象はプライバシーポリシーで開示する。

この判断は「第三者への送信がない」という意味ではない。レシピ抽出に必要な元ページの文章、公開動画、URL、タイトル、説明欄等はZ.ai / Geminiへ送信する。OpenAIの画像生成には、既に抽出された構造化Recipeのタイトル、材料、手順だけを送信する。Foodfolioのアカウント情報とAI入力を分離することを実装上の境界とする。

## 2. AI Providerへ送らない情報

現行のJev semantic routingを含むAI経路では、少なくとも以下をTypeSafe / Jev、Z.ai、Gemini、OpenAIのrequest bodyやProvider向け識別メタデータとして渡さない。

- FoodfolioのDB上の `User.id`
- Firebase UID
- メールアドレス
- 氏名・プロフィール情報
- Firebase ID Tokenその他の認証Token
- FCM / APNs端末Token
- アプリのインストールID
- Foodfolioの通知設定

BackendはRecipeの所有者として `recipe.userId` を保持するが、これはDBの所有権管理と解析完了通知の宛先解決に使用し、AI Providerへ送る入力には含めない。

OpenAIの画像生成には、ChatGPT / Geminiの共有会話全文、共有URL、Foodfolio User ID、Recipe IDを送らない。Recipe IDはFoodfolio側の生成画像保存先prefixにのみ利用する。

## 3. AI Providerへ送る情報

### TypeSafe / Jev

Jevはレシピ抽出ではなくsemantic gate / routerとして使用し、SourceContentから抽出した判定用textだけを送る。

sourceごとの主な入力は以下。

- 一般Web: タイトル、説明、Recipe JSON-LDまたはページ本文から構成した `textForAi`
- YouTube: 決定論的な説明欄十分性判定を通過した場合のタイトル・説明欄
- Instagram: 取得できたmetadata / caption text
- TikTok動画: 取得できたtitle / caption text
- TikTok写真: 取得できた投稿文・ハッシュタグ。画像自体や画像URLはJevへ送らない
- ChatGPT / Gemini公開共有: 正規化したuser / assistant transcript

Jevへ以下は送らない。

- Foodfolio User ID / Recipe所有者情報
- email / Firebase UID / token
- 画像・動画本体
- 一時signed URL
- コメント、投稿者プロフィール等のroutingに不要な情報

Jevへ送った本文は通常ログへ保存しない。閾値再評価のため、Foodfolio側の構造化ログには正規化済みJev入力の文字数とSHA-256を保存できるが、これはProvider送信本文の複製ではない。

Jev障害時は同じWorker実行内で既存のZ.ai / Gemini / media routeへfail-openし、Jev障害だけを理由にRecipeをfailedへしない。

TypeSafe / Jevを実環境で有効にする環境では、外部AI利用の開示対象にTypeSafe / Jevを含め、実際の送信内容と本書が一致していることを確認する。

設計根拠:

- `docs/jev-production-routing.md`

### Z.ai

一般Web、AI共有会話、TikTokのテキスト解析等では、主に以下を送る。

- レシピ抽出用のsystem promptとJSON Schema
- 元ページから抽出したタイトル、説明、Recipe JSON-LDまたはページ本文
- ChatGPT / Gemini公開共有会話から正規化したuser / assistant transcript
- YouTubeの場合は公開メタデータから構成した解析用テキスト
- TikTok動画fallbackでは解析対象動画の一時signed URLと公開メタデータ
- TikTok写真では投稿文・ハッシュタグと、先頭10枚のうち取得できた画像の一時signed URL。コメント、投稿者プロフィール、楽曲情報は含めない

実装根拠:

- `src/application/analysis/types.ts`
- `src/infrastructure/url/source-content-extractor.ts`
- `src/infrastructure/url/ai-aware-source-content-extractor.ts`
- `src/infrastructure/ai/zai-recipe-extractor.ts`
- `src/infrastructure/tiktok/tiktok-video-recipe-fallback.ts`
- `src/infrastructure/tiktok/tiktok-photo-recipe-analysis.ts`

### Google Gemini

YouTube説明欄だけで材料・工程を確認できない場合、主に以下を送る。

- 公開YouTube動画URL
- YouTubeタイトル
- YouTube説明欄
- レシピ抽出用promptとresponse schema

実装根拠:

- `src/infrastructure/ai/gemini-youtube-recipe-extractor.ts`

### OpenAI

新規のChatGPT / Gemini公開共有レシピで、元画像がなく、レシピ抽出後に材料と手順が1件以上ある場合だけ、代表サムネイル生成を依頼する。

送信するのはRecipeExtractorが返した構造化Recipeの以下の情報だけとする。

- レシピタイトル
- 材料名と分量
- 手順
- 固定の画像生成指示

元の共有会話全文はOpenAI画像生成へ再送信しない。構造化Recipeの文字列はuntrusted dataとして固定prompt内へ埋め込み、Recipeフィールド内の命令文を画像生成指示として扱わないよう明示する。

実装根拠:

- `src/application/analysis/recipe-thumbnail.ts`
- `src/infrastructure/ai/openai-recipe-thumbnail-generator.ts`
- `docs/ai-shared-thumbnail-generation.md`

### TikTokメディアの一時保存

TikTok動画fallbackと写真解析では、動画または画像を非公開のGoogle Cloud Storageへ一時配置し、ランダムUUIDを使ったobject名のsigned URLをZ.aiへ渡す。写真は先頭10枚を上限とし、一部が取得できなくても成功分が1枚以上あれば解析を続ける。

- object名にFoodfolioのUser IDやRecipe IDを埋め込まない
- signed URLの有効期間は10分
- 正常・異常終了時とも処理後の削除を試行する
- 残存した一時ファイルはStorage lifecycleによる削除対象とする

実装根拠:

- `src/infrastructure/tiktok/gcs-temporary-video-store.ts`
- `src/infrastructure/media/gcs-temporary-media-store.ts`
- `src/infrastructure/tiktok/tiktok-photo-recipe-analysis.ts`

### AI生成サムネイルの永続保存

OpenAIが生成したサムネイルは、TikTok / Instagram解析用の一時bucketとは分離したGoogle Cloud Storageへ永続保存する。

- object名は `recipe-images/{recipeId}/{randomUUID}.webp`
- User IDはobject名へ含めない
- 画像はFoodfolioの既存 `Recipe.imageUrl` 表示経路で利用するためpublic HTTPS URLから取得可能にする
- bucketのpublic権限は既知object URLの読み取りに必要な `storage.objects.get` のみに限定し、publicなobject list権限は付与しない
- Recipe削除またはアカウント削除時にFoodfolio管理下の生成画像を先に削除する
- 生成直後にRecipeが削除済みになった場合も生成objectを清掃する

生成画像自体にはFoodfolioのアカウント情報を埋め込む用途は持たない。

実装根拠:

- `src/infrastructure/media/gcs-generated-recipe-image-store.ts`
- `src/api/routes.ts`
- `infra/terraform/main.tf`

## 4. アカウント情報とAI入力の分離

レシピ抽出処理のデータフローは次のとおり。

```text
Recipe（Foodfolio DB）
  ├─ userId ───────────────→ 所有権・通知処理のみ
  └─ originalUrl
        ↓
SourceContentExtractor
        ↓
SourceContent
  - sourceType
  - resolvedUrl
  - imageUrl
  - textForAi
  - youtubeTitle
  - youtubeDescription
  - tiktokMediaKind
  - tiktokPhotoImageUrls
        ↓
必要なsourceのみ RecipeContentClassifier
        ↓
TypeSafe / Jev
        ↓ route decision / fail-open
Z.ai / Gemini / Media Adapter
        ↓
ExtractedRecipe
  - title
  - ingredients
  - steps
        ↓ AI共有レシピで生成条件を満たす場合のみ
OpenAI Image API
```

`SourceContent`、Jev判定入力、OpenAI向け画像生成入力にFoodfolioの利用者識別子を追加しないことを、AI Provider境界の基本ルールとする。Jevのclassification probability、threshold、route、入力hash等の運用ログはFoodfolio側のobservabilityであり、Providerへ追加送信する識別メタデータとして扱わない。

## 5. AI専用同意を持たない理由

Apple App Review Guidelines 5.1.2(i) は、個人データを第三者（第三者AIを含む）と共有する場合の開示と許可について定めている。

FoodfolioのAI Provider requestは、現行のJev semantic routingを含めても上記のとおりFoodfolio利用者を識別するアカウント情報を含めない。したがって、現行のデータフローでは「AIを利用すること」だけを理由に独立したAI同意状態を持たず、外部AIの利用目的と送信対象をプライバシーポリシーで開示する方針とする。

参考:

- Apple App Review Guidelines 5.1 Privacy: <https://developer.apple.com/app-store/review/guidelines/#privacy>

## 6. 注意点

元ページ、動画、タイトル、説明欄、公開共有会話などの公開コンテンツ自体に、投稿者名、SNSアカウントその他の個人に関する記載が含まれる可能性はある。現行実装は、それらをZ.ai / Gemini送信前に完全除去する仕組みではない。

OpenAI画像生成では元の公開共有会話を送らず、Z.ai等が抽出した構造化Recipeへ入力を縮小する。それでもRecipeタイトル、材料、手順自体に公開コンテンツ由来の文字列が含まれる可能性はある。

これはFoodfolioアカウントの `userId`、メールアドレス、端末Token等をAIへ渡すこととは区別する。必要に応じて、AI入力を機能提供に必要な情報へさらに限定するデータ最小化を行う。

また、外部コンテンツの取得・動画解析・生成画像の公開については、AI同意とは別に、対象サービスの利用条件、コンテンツ利用許諾、Appleの知的財産関連要件を確認する。

## 7. 再検討が必要になる変更

以下のいずれかをAI Providerへ送る仕様を追加する場合、この方針をそのまま流用せず、プライバシーポリシー、App Store ConnectのApp Privacy、同意要否を再評価する。

- FoodfolioのUser ID、Firebase UID、メールアドレス等
- ユーザーがFoodfolio内で入力した自由記述メモ
- ユーザー自身が撮影・アップロードした画像や動画
- 非公開ドキュメントやPrivate URLの内容
- ユーザーの検索履歴・利用履歴
- 利用者単位で追跡可能なProvider metadata
- AI requestとFoodfolioユーザーを外部Provider側で直接結び付けられる新しい識別子

## 8. 同意機能廃止時の実装整理

AI専用同意を廃止する変更では以下を削除する。

- iOSの同意画面・同意store・起動時gate・設定画面の撤回UI
- Share Extensionの同意判定
- `/v1/ai-consent` API
- Recipe作成APIの同意gate
- Prisma `UserSetting.aiConsentedAt`
- AI同意専用テストとmock

既に適用済みのmigration履歴は改変しない。`aiConsentedAt`を追加した過去migrationは履歴として保持する。稼働中の旧Backendがこのcolumnを参照している間はdropせず、AI同意へ依存しないBackendを先に反映する。新iOSへの切替後、旧Backend revisionへrollbackしないことを確認してから、後続の独立したmigrationでcolumnをdropする。
