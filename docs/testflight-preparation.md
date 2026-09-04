# TestFlight準備の確認記録

確認日: 2026-09-04。自動テスト、署名済みArchive、Apple側の処理状態、実機確認は別の証跡として扱う。

## 公開ページ

- [情報ページ](https://foodfolio-af28aa.web.app/)
- [プライバシーポリシー](https://foodfolio-af28aa.web.app/privacy)
- [サポート](https://foodfolio-af28aa.web.app/support)
- Firebase Hostingの既存サイト `foodfolio-af28aa` に静的HTML/CSSのみを配置。Cloud Runのコンテナ・設定は変更しない。
- 設定は `firebase.json`、公開ファイルは `hosting/public/`。更新コマンドは `npm run deploy:hosting`。対象プロジェクトとADCのquota projectをコマンドで明示する。
- iOS設定画面からポリシー・サポートを開くリンクはbuild 2に含まれる。
- 公開メールはユーザー承認済みの `kei.patheng@gmail.com`。審査用電話番号は公開ページやリポジトリに保存しない。

## データ棚卸し

| データ | 保存・送信先と目的 | 主な実装根拠 |
| --- | --- | --- |
| 認証UID・メール・氏名等 | Firebase Authentication、Apple/Google認証。本人確認。NeonのUserにはFirebase UID等を保存し、メール・氏名列は持たない | `ios/Foodfolio/Core/Auth/AuthService.swift`、`prisma/schema.prisma` |
| URL・レシピ・タグ | API、Cloud Tasks、Neon、端末のSwiftData。解析、保存、同期、表示 | `src/api/routes.ts`、`prisma/schema.prisma` |
| 元ページの本文・動画・メタデータ | 元サイト、YouTube/TikTok、必要時の一時ストレージ、Z.ai。レシピ抽出 | `src/infrastructure/url/source-content-extractor.ts`、`src/infrastructure/ai/zai-recipe-extractor.ts` |
| FCM/APNs token・インストールID | Firebase Messaging/APNs、Foodfolio API・Neon。解析通知。Neon上では利用者に紐付く | `ios/Foodfolio/Core/Notifications/NotificationService.swift`、`prisma/schema.prisma` |
| 検索履歴 | 端末内のみ。サーバーへ送らない | `ios/Foodfolio/Core/Persistence/SearchHistoryStore.swift` |
| 画像・元サイト通信 | 画像表示時は端末から画像配信元へ直接通信。サーバーだけが通信する構成ではない | `ios/Foodfolio/Core/Images/RecipeImageStore.swift` |
| リクエスト・診断情報 | Cloud Run/Logging、各SDK提供者。障害調査・不正防止・SDK品質維持 | `src/api/build-api.ts`、Archive内SDKのPrivacy Manifest |

### 保存と削除の範囲

- APIのアカウント削除はFirebaseユーザーとNeonの利用者・関連データを削除する。リレーションはcascade。iOSは操作した端末のローカルデータを消去する。別端末のキャッシュや提供者のバックアップまで即時に消えるとは宣言しない。
- Google Cloud `_Default` の通常ログ保持設定は30日と確認済み。すべての監査ログ・外部サービスに共通する保持期間ではない。
- TikTok一時動画は処理後に削除する。GCSは作成1日経過を条件にlifecycle削除、soft delete無効。lifecycleは非同期なので「1日以内の完全削除」とは宣言しない（`infra/terraform/main.tf`）。
- サーバーのZ.aiリクエストには認証UID・メールを明示的に渡さない。ただし元ページ・動画中の個人情報が除去される実装ではない。

### Archive内のSDK申告

build 2の実物の `PrivacyInfo.xcprivacy` を確認した。これはXcode Organizerの集約Privacy Reportの生成・確認を代替したと扱わない。

| 対象 | 収集カテゴリの申告 |
| --- | --- |
| Foodfolio本体 | 氏名、メール、ユーザーID、端末ID、その他ユーザーコンテンツ。利用者に紐付く・アプリ機能目的・trackingなし |
| Firebase Auth / Installations / GoogleDataTransport | 主にその他診断データ。SDK側にはAnalytics目的の申告がある |
| Firebase Messaging | 端末ID、その他データ、その他診断データ。アプリ独自に保存するFCM tokenは利用者に紐付くため本体にも申告 |
| GoogleSignIn | 氏名、メール、電話番号、その他データ、おおよその位置、ユーザーID、端末ID、その他利用状況。機能・Analytics目的を含む |

Firebase Analytics/Crashlyticsを含めないことと、他SDKの診断・Analytics目的のデータ収集がゼロであることは同義ではない。GoogleSignInのSDK申告と実際に要求する認証scopeを照合し、App Privacy回答を確定する。電話番号やGPSを入力・取得するアプリ機能はないが、SDKの申告を無視しない。

公式確認先: [Firebaseの情報開示](https://firebase.google.com/docs/ios/app-store-data-collection)、[Google Sign-Inの情報開示](https://developers.google.com/identity/sign-in/ios/app-privacy)。

## 配布と検証

- version `1.0`、build `2`、iPhone、iOS `26.0` 以上。接続先は既存のFoodfolio dev API。
- Distribution署名、`aps-environment=production`、Sign in with Apple、`get-task-allow=false`、`ITSAppUsesNonExemptEncryption=false` をArchiveで確認。
- `npm run verify`: unit 74、integration 21、E2E 14、およびPrisma、lint、format、build成功。
- `npm run verify:ios`: 71件成功、失敗0、skip0。新規のURLテストと設定画面のリンク存在確認を含む。
- iOS自動テストはscheme既定のDebug。Releaseの署名付きArchive・export・Apple validationは別に成功。Release実機の認証・Push・主要フローは未確認。
- build 2 (`bc3cca8b-6824-4ffc-bac0-708c6862325c`): Archive / export / `altool --validate-app` / upload成功。Apple processingは `VALID`、内部は `IN_BETA_TESTING`、外部は `READY_FOR_BETA_SUBMISSION`。
- 内部グループ `Foodfolio Internal` を作成し、既存App Store Connect管理者1名を登録。全build自動配布、Mac、Vision、公開リンクは使用しない。
- 同グループにbuild 2を割り当て、テスターの `INVITED` 状態をAPI readbackで確認。インストール済み端末はまだ確認できない。What to Testはbuild 2に日本語で保存済み。
- App Store Connect APIキーでグループ・内部テスターの作成は成功。Beta App DescriptionとSupport URLの保存は403（キーの権限不足）。キーは変更しない。
- ChromeのTest Information、Support URL、Privacy Policy URLは入力済み・未保存。URLのSaveと審査提出は別操作。

## 外部審査前に残る確認

1. 内部TestFlightでbuild 2をインストールし、Apple/Google/メール認証、URL保存・解析・同期・検索、Push成功/失敗、通知OFF、ログアウト、Apple token失効を含むアカウント削除を実機確認する。
2. Test Informationの審査専用ログインアカウントを用意する。ログイン必須の画面ではユーザー名とパスワードが必須。個人用アカウントを流用せず、秘密情報をリポジトリに書かない。
3. 入力済みのURL・テスト情報をユーザーが保存する。App Privacyの回答・公開はまだ行っていない。
4. 外部AIへ送る内容・送信先の説明と明示的同意の導線を検討する。現在の追加画面にZ.aiの送信説明・同意はなく、元ページ中の個人情報を除去する仕組みもない。[Apple 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing) は第三者AIを含む個人データ共有前の説明と許可を要求する。審査で問題にならないと断定しない。
5. 外部動画のダウンロード・解析について、提供元の利用許諾と公開対象の範囲を確認する。許可済みURLでの技術検証だけでは一般利用の許諾は証明できない（[Apple 5.2](https://developer.apple.com/app-store/review/guidelines/#intellectual-property)）。
6. 外部グループ・What to Test・必須情報を揃えた後、審査提出はユーザーが行う。今回は外部審査・一般公開リリースを行わない。

## 入力文面の控え（認証情報を除く）

### Beta App Description

Foodfolioは、公開されているレシピのURLを保存し、材料や作り方を整理して、自分のレシピ帳として検索・編集できるアプリです。Webページや対応する動画の内容をAIで解析し、完了時にPush通知でお知らせします。解析結果は必ず元のレシピと照らし合わせて確認してください。初期テスト版のため、データや機能が変更される場合があります。

### What to Test

iOS 26以降のiPhoneで、ログイン、公開レシピURLの保存、AI解析後の材料・手順の表示、検索・編集・同期、解析結果のPush通知、設定画面のプライバシー／サポートリンクをご確認ください。不具合は再現手順と画面を添えてTestFlightのフィードバックからお知らせください。パスワード等の秘密情報は送らないでください。

### Review Notes

Foodfolio is a Japanese recipe organizer for iPhone running iOS 26 or later. Sign-in is required. On the first screen, select the email sign-in option and log in with the review account entered above. Apple and Google sign-in are also supported.

Save a public recipe URL using the add button. The app analyzes the source content using an external AI service, then displays the ingredients and instructions. Please verify AI-generated results against the original source. Enable notifications to receive analysis-completion alerts. Recipes can be searched and edited. Account deletion is available in the Account screen.

This beta uses the current Foodfolio backend environment. No purchase or subscription is required.
