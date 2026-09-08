# TestFlight準備の確認記録

最終更新日: 2026-09-09。自動テスト、署名済みArchive、Apple側の処理状態、実機確認は別の証跡として扱う。

## 公開ページ

- [情報ページ](https://foodfolio-af28aa.web.app/)
- [プライバシーポリシー](https://foodfolio-af28aa.web.app/privacy)
- [サポート](https://foodfolio-af28aa.web.app/support)
- Firebase Hostingの既存サイト `foodfolio-af28aa` に静的HTML/CSSのみを配置する。
- 設定は `firebase.json`、公開ファイルは `hosting/public/`。更新コマンドは `npm run deploy:hosting`。
- iOS設定画面からポリシー・サポートを開ける。
- 公開メールは `kei.patheng@gmail.com`。審査用認証情報はリポジトリへ保存しない。

## データ棚卸し

| データ | 保存・送信先と目的 | 主な実装根拠 |
| --- | --- | --- |
| 認証UID・メール・氏名等 | Firebase Authentication、Apple/Google認証。本人確認。NeonのUserにはFirebase UIDを保存し、メール・氏名列は持たない | `ios/Foodfolio/Core/Auth/AuthService.swift`、`prisma/schema.prisma` |
| URL・レシピ・タグ | API、Cloud Tasks、Neon、端末のSwiftData。解析、保存、同期、表示 | `src/api/routes.ts`、`prisma/schema.prisma` |
| 元ページの本文・動画・メタデータ | 元サイト、YouTube/TikTok、必要時の一時ストレージ、Z.ai、YouTube説明欄が不十分な場合のGemini。レシピ抽出 | `src/infrastructure/url/source-content-extractor.ts`、`src/infrastructure/ai/zai-recipe-extractor.ts`、`src/infrastructure/ai/gemini-youtube-recipe-extractor.ts` |
| FCM/APNs token・インストールID | Firebase Messaging/APNs、Foodfolio API・Neon。解析通知。Neon上では利用者に紐付く | `ios/Foodfolio/Core/Notifications/NotificationService.swift`、`prisma/schema.prisma` |
| 検索履歴 | 端末内のみ。サーバーへ送らない | `ios/Foodfolio/Core/Persistence/SearchHistoryStore.swift` |
| 画像・元サイト通信 | 画像表示時は端末から画像配信元へ直接通信 | `ios/Foodfolio/Core/Images/RecipeImageStore.swift` |
| リクエスト・診断情報 | Cloud Run/Logging、各SDK提供者。障害調査・不正防止・SDK品質維持 | `src/api/build-api.ts`、Archive内SDKのPrivacy Manifest |

### AI Providerへの送信境界

現行実装では、Z.ai / GeminiのAI解析リクエストへFoodfolio利用者を識別するアカウント情報を含めない。

AI Providerへ送らないもの:

- Foodfolio DBのUser ID
- Firebase UID
- メールアドレス・氏名
- Firebase ID Token
- FCM / APNs token
- アプリのインストールID

AI Providerへ送るものは、レシピ抽出に必要な元ページ本文、公開URL、公開動画、タイトル、説明欄、関連メタデータ等である。`RecipeAnalysisService`はRecipe所有者の `userId` をDB所有権・通知処理に使うが、AI Adapterへ渡す `SourceContent` には含めない。

このデータ境界に基づき、現行仕様ではAI利用だけを対象にした専用同意状態、認証前同意gate、同意API、同意撤回を設けない。外部AIの利用と送信対象はプライバシーポリシーで開示する。詳細は `docs/ai-data-handling.md` を参照する。

元ページや公開動画自体に投稿者名等が含まれる可能性はあり、現行実装は元コンテンツ中の個人情報をAI送信前に完全除去するものではない。AI入力のデータ最小化と外部コンテンツの利用許諾は、Foodfolio利用者のアカウント識別情報をAIへ送らないこととは別の論点として扱う。

### 保存と削除の範囲

- APIのアカウント削除はFirebaseユーザーとNeonの利用者・関連データを削除する。iOSは操作した端末のローカルデータを消去する。
- Google Cloud `_Default` の通常ログ保持設定は30日。監査ログ、バックアップ、外部サービスの保持期間は各提供者の方針に従う。
- TikTok一時動画は処理後に削除する。GCSは作成1日経過を条件にlifecycle削除、soft delete無効。lifecycleは非同期なので「1日以内の完全削除」とは宣言しない。

## Archive内のSDK申告

build 2の実物の `PrivacyInfo.xcprivacy` を確認済み。Xcode Organizerの集約Privacy Reportの生成・確認を代替したとは扱わない。

| 対象 | 収集カテゴリの申告 |
| --- | --- |
| Foodfolio本体 | 氏名、メール、ユーザーID、端末ID、その他ユーザーコンテンツ。利用者に紐付く・アプリ機能目的・trackingなし |
| Firebase Auth / Installations / GoogleDataTransport | 主にその他診断データ。SDK側にはAnalytics目的の申告がある |
| Firebase Messaging | 端末ID、その他データ、その他診断データ。アプリ独自に保存するFCM tokenは利用者に紐付くため本体にも申告 |
| GoogleSignIn | 氏名、メール、電話番号、その他データ、おおよその位置、ユーザーID、端末ID、その他利用状況。機能・Analytics目的を含む |

Firebase Analytics/Crashlyticsを含めないことと、他SDKの診断・Analytics目的のデータ収集がゼロであることは同義ではない。GoogleSignInのSDK申告と実際に要求する認証scopeを照合し、App Privacy回答を確定する。

公式確認先: [Firebaseの情報開示](https://firebase.google.com/docs/ios/app-store-data-collection)、[Google Sign-Inの情報開示](https://developers.google.com/identity/sign-in/ios/app-privacy)。

## 既存TestFlight配布履歴

- 次回内部配布はversion `1.0`、build `7`、iPhone、iOS `26.0` 以上。接続先は既存のFoodfolio dev API。
- build 2 (`bc3cca8b-6824-4ffc-bac0-708c6862325c`): Archive / export / Apple validation / upload成功。
- build 3 (`cb9cbeec-da15-4e08-b2a1-79b1a86ef79e`): 当時の判断に基づくAI送信同意を含むbuild。Archive / export / Apple validation / upload成功。
- build 5 (`aaf7a5b6-645c-4cc1-aa39-c9c5f9cffef5`): Share ExtensionとApp Group対応、および当時のAI同意実装を含む。Apple processing `VALID`、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認済み。
- build 6 (`0edb524b-20d2-4589-9fa5-320e26d62165`): AI同意機能の廃止と共有シートの送信確認・二重送信防止を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 3 / 5に含まれるAI同意実装は配布履歴として残るが、現在のソース仕様では廃止対象であり、次回buildでは利用しない。
- 内部グループ `Foodfolio Internal` に既存App Store Connect管理者1名を登録済み。

## build 6の準備状況

- `npm run verify`: unit 156、integration 22、E2E 27、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 78件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- AI同意依存を削除したBackend SHA `254c08791a2f11692b3d41bd2a5a6f2d3756b785` をdevへ反映。API `foodfolio-dev-api-00017-ntq`、Worker `foodfolio-dev-worker-00020-qgs`、traffic 100%を確認。
- 更新したプライバシーポリシーをFirebase Hostingへ反映し、公開ページでAI送信境界の更新を確認。
- Release Archive、IPA export、Apple validation、uploadに成功。build ID `0edb524b-20d2-4589-9fa5-320e26d62165`のprocessing `VALID`と`Foodfolio Internal`への割り当てを確認。

## 外部審査前に残る確認

1. AI同意機能を削除した次回TestFlight buildで、新規起動時に不要な同意画面が出ず、ログイン後にURL保存・AI解析・同期・検索・Push通知・Share Extensionが動作することを実機確認する。
2. 同意APIとRecipe作成gateを削除したBackendをDB変更より先に対象環境へ反映する。旧iOS buildは互換対象外とし、Backend反映後に新iOSだけを利用する。
3. 新iOSへの切替後、旧Backend revisionへrollbackしないことを確認してから、`aiConsentedAt`をdropするmigrationを独立した後続リリースとして適用する。migrationはアプリ起動時には実行しない。
4. 更新したプライバシーポリシーをFirebase Hostingへ反映し、App Store ConnectのPrivacy Policy URLから最新内容へ到達できることを確認する。
5. App Store ConnectのApp Privacyを、Foodfolio本体と組み込みSDKが実際に扱うデータ、利用目的、ユーザーとの紐付け、tracking有無に合わせて回答・公開する。
6. 作成済みの審査専用ログインアカウントをTest Informationへ設定する。認証情報はリポジトリへ記載しない。
7. 外部動画のダウンロード・解析について、提供元の利用許諾と公開対象の範囲を確認する。AI同意の有無とは別に扱う。
8. 外部グループ・What to Test・必須情報を揃えた後にTestFlight App Reviewへ提出する。

## 入力文面の控え（認証情報を除く）

### Beta App Description

Foodfolioは、公開されているレシピのURLを保存し、材料や作り方を整理して、自分のレシピ帳として検索・編集できるアプリです。Webページや対応する動画の内容をAIで解析し、完了時にPush通知でお知らせします。解析結果は必ず元のレシピと照らし合わせて確認してください。初期テスト版のため、データや機能が変更される場合があります。

### What to Test（次回build用）

build 7では、レシピ追加画面をクリップボード内のWeb URLから貼り付けやすい導線に変更しました。候補がない場合や貼り付けを許可しない場合も手入力できます。また、月次のAI解析受付上限に到達した場合は理由を表示します。起動・ログイン、URLの貼り付けと手入力、レシピ作成、AI解析、検索・同期、Push通知をご確認ください。

### Review Notes

Foodfolio is a Japanese recipe organizer for iPhone running iOS 26 or later. Sign in with the review account using the email sign-in option. Apple and Google sign-in are also supported.

Save a public recipe URL using the add button or share a URL to Foodfolio from the iOS share sheet. The app analyzes the public source content using external AI services and then displays the extracted ingredients and instructions. Foodfolio account identifiers such as the app user ID, Firebase UID, email address, authentication token, and push-notification token are not included in the Z.ai or Google Gemini analysis requests. The source page or public video itself may contain publisher information. Please verify AI-generated results against the original source.

Enable notifications to receive analysis-completion alerts. Recipes can be searched and edited. Account deletion is available in the Account screen. No purchase or subscription is required.
