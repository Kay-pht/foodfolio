# TestFlight準備の確認記録

最終更新日: 2026-09-14。自動テスト、署名済みArchive、Apple側の処理状態、実機確認は別の証跡として扱う。

## 公開ページ

- [情報ページ](https://foodfolio-af28aa.web.app/)
- [プライバシーポリシー](https://foodfolio-af28aa.web.app/privacy)
- [サポート](https://foodfolio-af28aa.web.app/support)
- Firebase Hostingの既存サイト `foodfolio-af28aa` に静的HTML/CSSのみを配置する。
- 設定は `firebase.json`、公開ファイルは `hosting/public/`。更新コマンドは `npm run deploy:hosting`。
- iOS設定画面からポリシー・サポートを開ける。
- 公開メールは `kei.patheng@gmail.com`。審査用認証情報はリポジトリへ保存しない。

## データ棚卸し

| データ                           | 保存・送信先と目的                                                                                                | 主な実装根拠                                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 認証UID・メール・氏名等          | Firebase Authentication、Apple/Google認証。本人確認。NeonのUserにはFirebase UIDを保存し、メール・氏名列は持たない | `ios/Foodfolio/Core/Auth/AuthService.swift`、`prisma/schema.prisma`                                                                                               |
| URL・レシピ・タグ                | API、Cloud Tasks、Neon、端末のSwiftData。解析、保存、同期、表示                                                   | `src/api/routes.ts`、`prisma/schema.prisma`                                                                                                                       |
| 元ページの本文・動画・メタデータ | 元サイト、YouTube/TikTok、必要時の一時ストレージ、Z.ai、YouTube説明欄が不十分な場合のGemini。レシピ抽出           | `src/infrastructure/url/source-content-extractor.ts`、`src/infrastructure/ai/zai-recipe-extractor.ts`、`src/infrastructure/ai/gemini-youtube-recipe-extractor.ts` |
| FCM/APNs token・インストールID   | Firebase Messaging/APNs、Foodfolio API・Neon。解析通知。Neon上では利用者に紐付く                                  | `ios/Foodfolio/Core/Notifications/NotificationService.swift`、`prisma/schema.prisma`                                                                              |
| 検索履歴                         | 端末内のみ。サーバーへ送らない                                                                                    | `ios/Foodfolio/Core/Persistence/SearchHistoryStore.swift`                                                                                                         |
| 画像・元サイト通信               | 画像表示時は端末から画像配信元へ直接通信                                                                          | `ios/Foodfolio/Core/Images/RecipeImageStore.swift`                                                                                                                |
| リクエスト・診断情報             | Cloud Run/Logging、各SDK提供者。障害調査・不正防止・SDK品質維持                                                   | `src/api/build-api.ts`、Archive内SDKのPrivacy Manifest                                                                                                            |

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

| 対象                                                | 収集カテゴリの申告                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Foodfolio本体                                       | 氏名、メール、ユーザーID、端末ID、その他ユーザーコンテンツ。利用者に紐付く・アプリ機能目的・trackingなし            |
| Firebase Auth / Installations / GoogleDataTransport | 主にその他診断データ。SDK側にはAnalytics目的の申告がある                                                            |
| Firebase Messaging                                  | 端末ID、その他データ、その他診断データ。アプリ独自に保存するFCM tokenは利用者に紐付くため本体にも申告               |
| GoogleSignIn                                        | 氏名、メール、電話番号、その他データ、おおよその位置、ユーザーID、端末ID、その他利用状況。機能・Analytics目的を含む |

Firebase Analytics/Crashlyticsを含めないことと、他SDKの診断・Analytics目的のデータ収集がゼロであることは同義ではない。GoogleSignInのSDK申告と実際に要求する認証scopeを照合し、App Privacy回答を確定する。

公式確認先: [Firebaseの情報開示](https://firebase.google.com/docs/ios/app-store-data-collection)、[Google Sign-Inの情報開示](https://developers.google.com/identity/sign-in/ios/app-privacy)。

## 既存TestFlight配布履歴

- 最新の内部・外部配布はversion `1.0`、build `12`、iPhone、iOS `26.0` 以上。接続先は既存のFoodfolio dev API。
- build 2 (`bc3cca8b-6824-4ffc-bac0-708c6862325c`): Archive / export / Apple validation / upload成功。
- build 3 (`cb9cbeec-da15-4e08-b2a1-79b1a86ef79e`): 当時の判断に基づくAI送信同意を含むbuild。Archive / export / Apple validation / upload成功。
- build 5 (`aaf7a5b6-645c-4cc1-aa39-c9c5f9cffef5`): Share ExtensionとApp Group対応、および当時のAI同意実装を含む。Apple processing `VALID`、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認済み。
- build 6 (`0edb524b-20d2-4589-9fa5-320e26d62165`): AI同意機能の廃止と共有シートの送信確認・二重送信防止を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 7 (`063c15a7-b6fb-4034-8860-203185b377f7`): クリップボード優先のレシピ追加導線と月次AI解析受付上限のiOS表示を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 8 (`4d337a07-fd2d-46c4-80c6-73bc2bf8d61c`): 欠損したレシピ画像の元URLからの復旧を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 9 (`1d7c06fc-fc52-43ea-b1c8-7ad9567bd8ef`): 画像再取得で初回解析と同じ媒体別の代表画像解決を使用する変更を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 10 (`32d303fd-1280-4f75-ad38-16d061d79654`): Share Extensionの標準Postと送信結果表示、およびTikTok写真投稿の画像優先解析を含む。Apple processing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION` を確認し、`Foodfolio Internal`へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 11 (`00863d38-fc2a-4ae8-a331-f64959c54fca`): 共有タグの多対多永続化と旧SwiftData storeの移行を含む。Apple processing `VALID`、build有効、内部・外部とも `IN_BETA_TESTING`、Beta App Review `APPROVED` を確認し、`Foodfolio Internal` と `Foodfolio External` へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 12 (`366c4a95-5fc5-449b-962f-a124b577bb47`): 「作りたい」レシピの保存・専用表示と、同期・編集操作の競合対策を含む。Apple processing `VALID`、build有効、内部・外部とも `IN_BETA_TESTING`、Beta App Review `APPROVED` を確認し、`Foodfolio Internal` と `Foodfolio External` へ割り当て済み。日本語の「テストしてほしいこと」も保存・再取得確認済み。
- build 3 / 5に含まれるAI同意実装は配布履歴として残るが、現在のソース仕様では廃止対象であり、次回buildでは利用しない。
- 内部グループ `Foodfolio Internal` に既存App Store Connect管理者1名を登録済み。

## build 6の準備状況

- `npm run verify`: unit 156、integration 22、E2E 27、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 78件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- AI同意依存を削除したBackend SHA `254c08791a2f11692b3d41bd2a5a6f2d3756b785` をdevへ反映。API `foodfolio-dev-api-00017-ntq`、Worker `foodfolio-dev-worker-00020-qgs`、traffic 100%を確認。
- 更新したプライバシーポリシーをFirebase Hostingへ反映し、公開ページでAI送信境界の更新を確認。
- Release Archive、IPA export、Apple validation、uploadに成功。build ID `0edb524b-20d2-4589-9fa5-320e26d62165`のprocessing `VALID`と`Foodfolio Internal`への割り当てを確認。

## build 7の配布結果

- 配布ソースはmain `0085d1b9a525dc35b69346ac8d85153bdf9b2a04`。
- `npm run verify`: unit 215、integration 29、E2E 27、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 82件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- Backend SHA `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d` はdevのAPI `foodfolio-dev-api-00025-dm7`、Worker `foodfolio-dev-worker-00028-f4r`でtraffic 100%。
- Release Archive、IPA export、Apple validation、uploadに成功。build ID `063c15a7-b6fb-4034-8860-203185b377f7`のprocessing `VALID`と`Foodfolio Internal`への割り当て、日本語の「テストしてほしいこと」の再取得を確認。

## build 8の配布結果

- 配布ソースはmain `052fea7fe05d0128e1901dc8716363fc283d2b6c`。
- `npm run verify`: unit 215、integration 36、E2E 28、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 91件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- 料理名生成を強化したBackend SHA `bf933657bcdb87bccaae4c36df4331600a74430a` はdevのAPI `foodfolio-dev-api-00026-tq9`、Worker `foodfolio-dev-worker-00029-xrz`でtraffic 100%。
- Release Archive、IPA export、Apple validation、uploadに成功。build ID `4d337a07-fd2d-46c4-80c6-73bc2bf8d61c`のprocessing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION`、`Foodfolio Internal`への割り当て、日本語の「テストしてほしいこと」の再取得を確認。

## build 9の配布結果

- 配布ソースはmain `f40b20736a64575b66dfcb5069ef8d894d231be6`。
- `npm run verify`: unit 221、integration 38、E2E 28、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 91件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- 画像再取得Backendを含むSHA `87e9ffb6621ef758b5f85d26b614205f7a8917a4` はdevのAPI `foodfolio-dev-api-00029-x8x`、Worker `foodfolio-dev-worker-00031-c5x`でtraffic 100%。APIが既存の `foodfolio-dev-youtube-api-key` Secretを参照することも確認。
- Release Archive、IPA export、uploadに成功。upload後に実行完了した単独validationは既存build 9として重複エラーになったが、App Store Connect APIでbuild ID `1d7c06fc-fc52-43ea-b1c8-7ad9567bd8ef`のprocessing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION`、`Foodfolio Internal`への割り当て、日本語の「テストしてほしいこと」の再取得を確認。

## build 10の配布結果

- 配布ソースはmain `80c6bc5b361f018ee24aea666403a5f45b5be074`。
- `npm run verify`: unit 238、integration 40、E2E 29、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: 99件成功、失敗0、skip 0。Swift format/lint、Debug build、unit・integration・UI E2Eを含む。
- TikTok写真解析BackendのSHA `b160924cc5c4f4477112b3836dadbd0bec959c08` はdevのAPI `foodfolio-dev-api-00031-mxm`、Worker `foodfolio-dev-worker-00034-v8p`でtraffic 100%。両serviceで `TIKTOK_MEDIA_ANALYSIS_ENABLED=true`、旧フラグ未設定、API health成功を確認。
- Release Archive、署名・entitlement確認、IPA export、uploadに成功。upload前の単独validationはローカル実行時のissuer変数名誤りにより401、upload後の正しい再実行は既存build 10として重複エラーになった。App Store Connect APIでbuild ID `32d303fd-1280-4f75-ad38-16d061d79654`のprocessing `VALID`、build有効、内部 `IN_BETA_TESTING`、外部 `READY_FOR_BETA_SUBMISSION`、`Foodfolio Internal`への割り当て、日本語の「テストしてほしいこと」の再取得を確認。

## 外部審査前に残る確認

1. build 10の実機で起動・認証・URL保存・AI解析・Push通知はユーザー確認済み。Share Extensionは正常に動作しなかったため既知の不具合として外部テスト情報へ開示し、アプリ内の追加ボタンを代替手順とする。Share Extensionの修正と再検証は後続buildで行う。
2. 同意APIとRecipe作成gateを削除したBackendをDB変更より先に対象環境へ反映する。旧iOS buildは互換対象外とし、Backend反映後に新iOSだけを利用する。
3. 新iOSへの切替後、旧Backend revisionへrollbackしないことを確認してから、`aiConsentedAt`をdropするmigrationを独立した後続リリースとして適用する。migrationはアプリ起動時には実行しない。
4. 更新したプライバシーポリシーはFirebase HostingでHTTP 200を確認し、外部TestFlightの日本語Test InformationへPrivacy Policy URLを保存・再取得済み。
5. App Store Connectの詳細なApp Privacy回答は、ユーザー承認によりApp Store一般公開前のタスクへ延期する。外部TestFlight完了をApp Privacy回答完了とは扱わない。
6. 審査専用ログインアカウントのパスワードをローテーションし、新しい認証情報によるFirebaseログイン成功を確認したうえでBeta App Review Informationへ保存・再取得済み。認証情報はリポジトリへ記載しない。
7. 外部動画のダウンロード・解析は、提供元から利用許諾を取得済みであることをユーザー確認済み。
8. 外部グループ `Foodfolio External`、build 10、テスター1件、What to Test、Test Information、Beta App Review Informationを設定し、TestFlight App Reviewへ提出済み。Apple承認と招待送信を待つ。

## build 10の外部TestFlight提出結果

- App Store Connect Team APIキーはApp Manager権限の専用キーを使用し、秘密鍵とenvはリポジトリ外で所有者のみ読み書き可能にした。キーID・秘密鍵・JWTはリポジトリや実行結果へ記録しない。
- 審査専用Firebaseアカウントのパスワードを2026-09-11にローテーションし、新しいパスワードでのログイン成功を確認した。認証情報はリポジトリ外にのみ保存する。
- 日本語Beta App Description、Feedback Email、Privacy Policy URL、build 10のWhat to Test、審査連絡先、審査アカウント、Review NotesをApp Store Connectへ保存し、APIで再取得して一致を確認した。
- 外部グループ `Foodfolio External` (`4f1c12bb-b63b-422e-a063-90cd7b94e4f7`) を作成し、公開リンク無効、feedback有効、build 10割り当て済み、ローカルのGit除外リストにあるテスター1件を関連付けた。
- build 10をTestFlight App Reviewへ提出。2026-09-11時点でsubmission ID `32d303fd-1280-4f75-ad38-16d061d79654`、review `WAITING_FOR_REVIEW`、external build `WAITING_FOR_BETA_REVIEW`、自動通知有効。
- 審査待ちのためテスター状態は `NOT_INVITED`。Apple承認後の招待送信とテスター状態の再取得は未確認であり、外部配布完了とは扱わない。
- 実機では起動・認証・URL保存・AI解析・Push通知をユーザー確認済み。Share Extensionは正常に動作せず、既知の制限とアプリ内追加の代替手順をWhat to TestとReview Notesへ明記した。
- 外部提出後の `npm run verify:ios` は99件成功、失敗0、skip 0。`npm run verify` はunit 238件、lint、format、build等に成功した後、既存のsync cursor順序テストがintegration 40件中1件失敗し、単独再実行でも再現した。今回の文書・App Store Connect設定変更とは分離して未解決とし、全体検証成功とは扱わない。

## build 11の外部TestFlight配布結果

- 配布ソースはmain `a49703f26b6f2ebb5c6a297596d613dbc11f1122`。mainのQuality、Documentation、Deploy devはいずれも成功した。
- `npm run verify`: unit 239、integration 40、E2E 29、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: SwiftData legacy-store migration検証と101件のiOSテストが成功、失敗0、skip 0。
- Release Archive、署名・entitlement確認、IPA export、Apple validation、uploadに成功。本体とShare Extensionはともに `1.0 (11)`、本体はproduction APNs、Sign in with Apple、共通App Group、Extensionは共通App Groupを保持している。
- App Store Connect Build ID `00863d38-fc2a-4ae8-a331-f64959c54fca` のprocessing `VALID`、build有効、`APP_STORE_ELIGIBLE`、暗号化申告 `false` をAPIで確認した。
- build 11を `Foodfolio Internal` と `Foodfolio External` へ割り当て、日本語の「テストしてほしいこと」を保存・再取得した。内部・外部とも `IN_BETA_TESTING`、自動通知有効、Beta App Review `APPROVED` を確認した。
- ユーザー指示により `Foodfolio External` の公開リンク有効状態を維持した。既存テスター構成は変更せず、API再取得時点で2件（`INSTALLED` 1件、`INVITED` 1件）。実際のbuild 11インストールと実機動作は別途確認する。

## build 12の外部TestFlight配布結果

- 配布ソースはmain `8833bc2ac6fb9ec0f1af7a51ba3a0993397994f5`。mainのQuality、Documentation、Deploy devはいずれも成功した。Deploy devはiOS build番号のみの差分を正しくskipし、Backendを含むmain `340a7c4cc772b790477dcb006a95f502579885f5` はdevへ反映済み。
- `npm run verify`: unit 239、integration 42、E2E 29、およびPrisma、lint、format check、TypeScript build成功。
- `npm run verify:ios`: SwiftData legacy-store migration検証と110件のiOSテストが成功、失敗0、skip 0。
- Release Archive、署名・entitlement確認、IPA export、Apple validation、uploadに成功。本体とShare Extensionはともに `1.0 (12)`、本体はproduction APNs、Sign in with Apple、共通App Group、Extensionは共通App Groupを保持している。
- App Store Connect Build ID `366c4a95-5fc5-449b-962f-a124b577bb47` のprocessing `VALID`、build有効、`APP_STORE_ELIGIBLE`、暗号化申告 `false` をAPIで確認した。
- build 12を `Foodfolio Internal` と `Foodfolio External` へ割り当て、日本語の「テストしてほしいこと」を保存・再取得した。内部・外部とも `IN_BETA_TESTING`、自動通知有効、Beta App Review `APPROVED` を確認した。
- `Foodfolio External` の公開リンク有効状態を維持した。既存テスター構成は変更せず、API再取得時点で2件（`INSTALLED` 1件、`INVITED` 1件）。実際のbuild 12インストールと実機動作は別途確認する。

## 入力文面の控え（認証情報を除く）

### Beta App Description

Foodfolioは、公開されているレシピのURLを保存し、材料や作り方を整理して、自分のレシピ帳として検索・編集できるアプリです。Webページや対応する動画の内容をAIで解析し、完了時にPush通知でお知らせします。解析結果は必ず元のレシピと照らし合わせて確認してください。初期テスト版のため、データや機能が変更される場合があります。

### What to Test（build 10）

build 10では、起動・メール／Apple／Googleログイン、アプリ内の追加ボタンからのURL保存、AI解析後の材料・手順表示、検索・編集・同期、解析完了時のPush通知、およびTikTok写真投稿の画像とキャプションを用いた解析をご確認ください。既知の制限として、Share Extensionからの追加は現在正常に完了しない場合があります。今回のテストではアプリ内の追加ボタンを使用してください。Share Extensionは後続buildで修正予定です。

### What to Test（build 11）

build 11では、複数のレシピで同じタグを共有しても関連付けが保持され、同期後やアプリ再起動後も各レシピのタグ表示とタグ検索が正しく動作することをご確認ください。build 10以前からアップデートした場合も、保存済みレシピのタグが復旧することをご確認ください。あわせて、起動・認証、URL保存、AI解析、検索・編集・同期、Push通知をご確認ください。既知の制限として、Share Extensionからの追加は正常に完了しない場合があります。アプリ内の追加ボタンを使用してください。

### What to Test（build 12）

build 12では、レシピ詳細のメニューから「作りたい」を追加・解除でき、追加したレシピがホーム上部の専用セクションへ移動し、同期後やアプリ再起動後も状態が保持されることをご確認ください。編集・削除・「作りたい」の操作と同期が前後しても最新の操作結果が保持され、削除済みレシピが再表示されないこともご確認ください。あわせて、起動・認証、URL保存、AI解析、タグ、検索、編集、同期、Push通知をご確認ください。既知の制限として、Share Extensionからの追加は正常に完了しない場合があります。アプリ内の追加ボタンを使用してください。

### Review Notes

Foodfolio is a Japanese recipe organizer for iPhone running iOS 26 or later. Sign in with the review account using the email sign-in option. Apple and Google sign-in are also supported.

Save a public recipe URL using the Add button inside the app. The app analyzes public source content using external AI services and displays extracted ingredients and instructions. Foodfolio account identifiers such as the app user ID, Firebase UID, email address, authentication token, and push-notification token are not included in the Z.ai or Google Gemini analysis requests. The source page or public video itself may contain publisher information, and the developer has confirmed permission for the external video analysis used in this beta. Please verify AI-generated results against the original source.

Enable notifications to receive analysis-completion alerts. Recipes can be searched and edited. Account deletion is available in the Account screen. No purchase or subscription is required.

Known limitation in build 10: the Share Extension may not complete URL submission. Please use the in-app Add button during review. This limitation will be fixed in a later beta build.
