# AI解析におけるデータ送信方針

最終更新日: 2026-09-10

## 1. 結論

Foodfolioの現行実装では、Z.ai / Google Geminiへレシピ解析を依頼する際に、Foodfolioの利用者を識別するためのアカウント情報をAI Providerのリクエストへ含めない。

そのため、FoodfolioではAI利用そのものを理由とした専用の同意状態、同意API、同意撤回、同意を前提としたアプリ利用制限を持たない。AI Providerの利用と送信対象はプライバシーポリシーで開示する。

この判断は「第三者への送信がない」という意味ではない。レシピ抽出に必要な元ページの文章、公開動画、URL、タイトル、説明欄等は外部AI Providerへ送信する。Foodfolioのアカウント情報とAI解析入力を分離することを実装上の境界とする。

## 2. AI Providerへ送らない情報

現行のAI解析経路では、少なくとも以下をZ.ai / Geminiのrequest bodyやProvider向け識別メタデータとして渡さない。

- FoodfolioのDB上の `User.id`
- Firebase UID
- メールアドレス
- 氏名・プロフィール情報
- Firebase ID Tokenその他の認証Token
- FCM / APNs端末Token
- アプリのインストールID
- Foodfolioの通知設定

BackendはRecipeの所有者として `recipe.userId` を保持するが、これはDBの所有権管理と解析完了通知の宛先解決に使用し、AI Adapterへ渡す `SourceContent` には含めない。

## 3. AI Providerへ送る情報

### Z.ai

一般Web、TikTokのテキスト解析等では、主に以下を送る。

- レシピ抽出用のsystem promptとJSON Schema
- 元ページから抽出したタイトル、説明、Recipe JSON-LDまたはページ本文
- YouTubeの場合は公開メタデータから構成した解析用テキスト
- TikTok動画fallbackでは解析対象動画の一時signed URLと公開メタデータ
- TikTok写真では投稿文・ハッシュタグと、先頭10枚のうち取得できた画像の一時signed URL。コメント、投稿者プロフィール、楽曲情報は含めない

実装根拠:

- `src/application/analysis/types.ts`
- `src/infrastructure/url/source-content-extractor.ts`
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

## 4. アカウント情報とAI入力の分離

解析処理のデータフローは次のとおり。

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
Z.ai / Gemini Adapter
```

`SourceContent`にFoodfolioの利用者識別子を追加しないことを、AI Provider境界の基本ルールとする。

## 5. AI専用同意を持たない理由

Apple App Review Guidelines 5.1.2(i) は、個人データを第三者（第三者AIを含む）と共有する場合の開示と許可について定めている。

Foodfolioの現行AI Provider requestは、上記のとおりFoodfolio利用者を識別するアカウント情報を含めない。したがって、現行のデータフローでは「AIを利用すること」だけを理由に独立したAI同意状態を持たず、外部AIの利用目的と送信対象をプライバシーポリシーで開示する方針とする。

参考:

- Apple App Review Guidelines 5.1 Privacy: <https://developer.apple.com/app-store/review/guidelines/#privacy>

## 6. 注意点

元ページ、動画、タイトル、説明欄などの公開コンテンツ自体に、投稿者名、SNSアカウントその他の個人に関する記載が含まれる可能性はある。現行実装は、それらをAI送信前に完全除去する仕組みではない。

これはFoodfolioアカウントの `userId`、メールアドレス、端末Token等をAIへ渡すこととは区別する。必要に応じて、AI入力をレシピ抽出に必要な情報へさらに限定するデータ最小化を行う。

また、外部コンテンツの取得・動画解析については、AI同意とは別に、対象サービスの利用条件、コンテンツ利用許諾、Appleの知的財産関連要件を確認する。

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
