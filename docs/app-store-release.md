# App Store リリース管理

## 更新 1.0.5 (18) の提出状況

2026-10-24（JST）にAppleの[日本向け公開lookup](https://itunes.apple.com/lookup?id=6806783378&country=jp)とApp Store Connect APIを読み戻した。公開版は `1.0.4 (17)`、version ID `2f6cf146-1e86-423b-b9de-68c2402835f5`、Build ID `1471a727-5c5e-4289-a7d5-4e859558c153`。App Store Connectは `READY_FOR_SALE` / `READY_FOR_DISTRIBUTION`、公開lookupの公開日時は `2026-10-17T15:42:55Z`（2026-10-18 00:42:55 JST）。最新upload済みbuildは17で、1.0.5は未作成。次のパッチ更新を **1.0.5 (18)** とする。下記の1.0.4審査待ち記録は提出当時の履歴である。

準備元はmain `3eff7064051086e5d6d784d5ef327ae988daf480`。[PR #149](https://github.com/Kay-pht/foodfolio/pull/149)はマージ済みで、Share Extensionの表示完了後に本文を読み取り専用へ切り替える修正を含む。本PRの製品変更は `ios/project.yml` と生成projectのバージョン番号のみ。本体とShare Extensionを揃えて更新する。

日本語の更新内容:

「共有メニューからFoodfolioを開いた際に、画面が正しく表示されない問題を修正しました。」

### 既存検証の利用と今回の差分確認

ユーザーの明示指示により、以下の成功済み検証は再実行しない。実機での繰り返し表示と投稿受付、unit 560件・結合73件・E2E70件・iOS139件、lint・format・build・最終CIはPR #149の証跡を利用する。[Quality成功](https://github.com/Kay-pht/foodfolio/actions/runs/40078689899)をAPIで読み戻し、対象HEAD `49c63be7b24ca38694ad18cbe7fae8b25a6836ed` と `conclusion: success` を確認した。CI対象HEADおよびPR #149最終HEAD `f51b2743452c5a541e77481e3df2727e59c7ccd4` から準備元mainへのiOS差分はない。mainのBackendには別途PR #150の差分があるため、このCIを現在のBackend全体の新規成功とは扱わない。

今回の番号更新後のソースに対する全体テスト・全体CIの新規成功は主張しない。新しい仕様のcheck、番号と生成projectの整合性、変更文書のcheckだけを実施する。Readyへの変更はAuto Fix / Qualityによる検証の再実行につながるため、この準備PRはDraftで引き渡す。独立レビューは別Reviewerセッションで行い、マージは人間が行う。

準備PR: [#151](https://github.com/Kay-pht/foodfolio/pull/151)（作成時Draft、2026-10-24に人間によるマージを確認）。新規spec check、task check、docs check、変更文書・仕様のformat check、diff checkは成功。本体・Share ExtensionのDebug / Releaseが共通設定から1.0.5 (18)を継承することを生成projectの解析で確認した。

### 準備・マージ後の提出チェックリスト

- [x] 公開版1.0.4 (17)、最新upload済みbuild 17、1.0.5未作成を確認
- [x] `APP-STORE-UPDATE-1-0-5` の仕様を実装前に確定し、`npm run check:specs` 成功（59仕様）
- [x] 本体・Share Extensionの番号を1.0.5 (18)へ更新し、生成projectの差分を確認
- [x] PR #149の既存成功結果を参照し、ユーザー指定の検証を再実行しない方針を記録
- [x] 人間による準備PRのマージ（独立レビューの証跡は本セッションでは確認していない）
- [x] マージ済みソースとApple側の番号競合を再確認
- [x] マージ済みソースから新しい配布用Archive / IPAを作成し、両targetの番号・署名・entitlements・日本語resourceを確認
- [x] Apple validation / upload、processing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告を読み戻す
- [x] 既存 `Foodfolio Internal` への割り当てと日本語What to Testを確認（テスター追加・外部招待なし）
- [x] 既存審査アカウント・認証付きAPI、掲載情報・画像・価格・地域を確認し、build 18を選択
- [x] 公開方式 `MANUAL` を読み戻してAppleへ審査提出し、Submission IDと審査状態を記録

### マージ後の配布記録

2026-10-24（JST）にPR #151の人間によるマージを確認した。配布ソースは `f8ab1617f31bda31969338a8b38d40739c4e3a49` で、準備PR最終HEAD `3f135d94` と同一tree。成功済みのunit・結合・E2E・iOS・lint・format・build・最終CIは再実行していない。新しい配布用Release Archive / IPAの作成、両targetの1.0.5 (18)、署名検証、App Group、日本語resource、本体のproduction APNs・Sign in with Appleを確認した。

Apple validationは `VERIFY SUCCEEDED with no errors`、uploadは `UPLOAD SUCCEEDED with no errors`。Delivery UUIDは `5ddd843a-5e88-4604-97c4-790461c6b01a`。Archive / IPA / ログはGit管理外の `/tmp/foodfolio-submit-105/` に保存した。書き出し時にExtension profile名の指定誤りで一度失敗したが、既存projectと同じprofile名に修正してexportが成功した。

App Store version IDは `0b09136d-e532-4315-924f-35afa1b4328e`。既存の日本語description・keywords・support URL等を維持し、更新内容のみ差し替えた。画像6枚は前版とfile名・サイズ・checksumが一致し、すべて `COMPLETE`。無料（JPY 0）、日本のみ、Food & Drink、掲載名と `MANUAL` を読み戻した。既存審査アカウントのFirebaseログインと認証付き `/v1/settings`・`/v1/recipes?limit=1`、API `/health` はHTTP 200。審査連絡先・資格情報は維持し、審査メモの先頭を今回の共有画面修正の説明に更新して読み戻した。秘密情報はGitへ保存しない。

Appleのupload処理は `COMPLETE`（エラー・警告なし）。Build ID `5ddd843a-5e88-4604-97c4-790461c6b01a` はprocessing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告 `false`。既存 `Foodfolio Internal` への割り当て、内部state `IN_BETA_TESTING`、共有画面修正を説明した日本語What to Testを読み戻した。テスター構成・外部グループ・公開リンクは変更していない。

2026-10-24 22:46:18（JST）にAppleへ審査提出した。Submission IDは `09c00d47-a2ac-43ea-b11f-f22766bc56cd`。提出後の再取得でversion / submissionの両方が `WAITING_FOR_REVIEW`、選択buildが18、公開方式が `MANUAL` であることを確認した。ユーザー依頼のAppleアップデート申請まで完了し、一般公開は行っていない。App Store本番反映はユーザーによる公開を確認するまで未完了とする。今回のiOS修正にBackend変更・DB migrationは不要で、Backendの追加デプロイは行っていない。

## 更新 1.0.4 (17) の提出状況

2026-10-16（JST）にAppleの[日本向け公開lookup](https://itunes.apple.com/lookup?id=6806783378&country=jp)とApp Store Connectを読み戻した。公開版は`1.0.3 (16)`（version ID `35229013-f68c-4595-a000-ba8f6a517246`、Build ID `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`）。最新upload済みbuildは`16`で、`1.0.4`は未作成だった。パッチ番号だけを上げ、次の候補を`1.0.4 (17)`とする。

準備元はmain `8e75ea7c`（PR #145 / #144まで取り込み済み）。前回の配布元`1b0e95d01aca9da29796eb414b070a953ad302ae`からiOSディレクトリに差分はなく、今回のiOS変更は本体とShare Extensionの番号更新のみ。Bundle ID、日本語resource、価格、配信地域、スクリーンショットは既存設定を維持する。

### mainに追加された変更と反映先

- PR #143 / #144: Instagram等のレシピ解析出力上限を10000トークンへ統一し、Instagramのreasoning effortをlowにする。Z.aiの個別timeoutは180秒。Cloud Run Workerへの反映が必要
- PR #145: 明確なInstagram閲覧制限を識別し、不要な再試行を止める。Cloud Run Workerへの反映が必要
- PR #142: 分析最終失敗ログ・Slackアラートに安全な対象URLを添付する。Workerへの反映と監視設定のTerraform適用が別々に必要

これらはBackend・監視の変更であり、iOS buildのuploadだけでは反映されない。既存の[自動デプロイ](https://github.com/Kay-pht/foodfolio/actions/runs/38870286716)が成功しており、追加デプロイは不要。2026-10-16（JST）にAPI `foodfolio-dev-api-00056-t7l` / Worker `foodfolio-dev-worker-00060-jss`のReadyとtraffic 100%を再取得した。source SHA `8e75ea7c1b2042a50ab7ca9ffd8714d51064fd11`のbuild/pushログと両サービスの配信imageを照合し、共通digest `sha256:567f8b34a417f9a44935b009127d0568cf9acc805649a0cce152c0170aabd587`の一致を確認した。実利用での解析完了率改善は未測定。

デプロイ後の保持状況も読み取り確認した。全regionのserviceは上記2件、Jobは0件。APIは42 revisions、Workerは43 revisionsで、各22件が30日超（最古2026-09-05）。Registryは39 versions中19件が30日超。これらは整理候補の調査対象であり、最新3件の成功証跡・全残存参照・親manifestの照合による削除対象の確定は未実施。今回の作業では削除しない。

監視設定のTerraform適用は別操作として管理し、反映済みとは記録しない。日本語の更新内容案は「レシピの取り込み処理を調整しました。」とし、申請直前に稼働環境を再確認する。

### 準備・検証・マージ後の提出チェックリスト

- [x] Appleの公開版・最新build・version重複を確認し、1.0.4 (17)を候補に決定
- [x] Specification as Codeを確定し、実装前に`npm run check:specs`成功（53仕様）
- [x] 本体・Share Extensionの生成projectとbuild済みbundleで1.0.4 (17)、表示名Foodfolio、日本語resourceを確認
- [x] `npm run verify`成功（単体540件・結合58件・E2E68件、lint・format・build・各guardrail）
- [x] `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer IOS_PARALLEL_WORKERS=1 npm run verify:ios`成功（136件、失敗0・skip0。単体75件・結合27件・UI34件、SwiftData migration・lint/format・buildを含む）
- [x] 準備PR [#146](https://github.com/Kay-pht/foodfolio/pull/146)の最新HEAD `ad5a529e`で[Quality成功](https://github.com/Kay-pht/foodfolio/actions/runs/38872294430)。人間によるマージを確認
- [x] マージ後の確定ソース `ada391b7bae7a12375706a84c6f5d1ffaf6ac5a2`は検証済みPR HEADと同一tree。[main Quality成功](https://github.com/Kay-pht/foodfolio/actions/runs/38895432012)。署名済みArchive / IPAを作成し、本体・Extensionの番号・署名・entitlements・日本語resourceを確認
- [x] 既存自動デプロイの成功とAPI / Workerの稼働source SHA・Ready・traffic・digestを読み戻す（追加デプロイなし）
- [x] Apple validation / upload後、processing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告`false`を確認。Build ID `1471a727-5c5e-4289-a7d5-4e859558c153`
- [x] 既存`Foodfolio Internal`へのbuild 17割り当て、`IN_BETA_TESTING`、日本語What to Testを読み戻した。テスター追加・外部招待は行っていない
- [x] 既存審査アカウントのFirebaseログインと認証付き `/v1/settings`・`/v1/recipes?limit=1`（HTTP 200）を確認。App Reviewの保存済み資格情報との一致を読み戻した。資格情報はGit・出力へ記録しない
- [x] App Store version 1.0.4へbuild 17を紐付け、更新内容・既存metadata・画像6枚・配信設定・公開方式`MANUAL`を読み戻した
- [x] 2026-10-16 21:00:33（JST）にAppleへ提出。Submission ID `dd746f85-c5bf-4e62-a2d1-ae56ba3fd3f1`、version / submissionともに`WAITING_FOR_REVIEW`を読み戻した

### マージ後の確認記録

2026-10-16（JST）にPR #146の人間によるマージを確認した。merge SHAは`ada391b7bae7a12375706a84c6f5d1ffaf6ac5a2`。署名済みRelease Archive / IPAの作成、Apple validation（`VERIFY SUCCEEDED with no errors`）、upload（`UPLOAD SUCCEEDED with no errors`）を完了した。Delivery UUIDは`1471a727-5c5e-4289-a7d5-4e859558c153`。本体のproduction APNs・Sign in with Apple、両targetのApp Group、日本語resource、署名検証も成功した。

API / Workerは準備時と同じrevisionを維持し、リポジトリの`verify-cloud-run-deployment.mjs`でReady・traffic 100%・期待image / digest・request-based billingを再検証した。API `/health`はHTTP 200。追加デプロイは実行していない。

App Store version IDは`2f6cf146-1e86-423b-b9de-68c2402835f5`。日本語の説明・keywords・support / marketing URL・promotional textは前バージョンと一致し、画像6枚もfile情報が一致、すべて`COMPLETE`。無料（JPY 0）、日本のみ、`MANUAL`を読み戻した。App Reviewの連絡先・既存メモを維持し、今回の調整がBackend側であることを追記した。

Apple処理は`COMPLETE`（エラー・警告なし）、build `17`はprocessing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告`false`。Build IDは`1471a727-5c5e-4289-a7d5-4e859558c153`。既存`Foodfolio Internal`への割り当てと`IN_BETA_TESTING`、日本語What to Testの保存・読み戻しを確認した。外部TestFlightへの今回の配布は行っていない。

2026-10-16 21:00:33（JST）にApp Reviewへ提出した。Submission IDは`dd746f85-c5bf-4e62-a2d1-ae56ba3fd3f1`。提出後にversion / submissionの両方が`WAITING_FOR_REVIEW`、release typeが`MANUAL`であることを再取得した。ユーザー依頼のAppleアップデート申請まで完了し、一般公開は行っていない。App Store本番チェックは公開を確認するまで未完了のまま維持する。

今回、エージェントによる実機のインストール・操作確認は行っていない。ローカル自動テスト、署名付きArchive、認証付きAPI確認、Apple処理・審査申請を別の証跡として扱う。

## 更新 1.0.3 (16) の公開状況

2026-10-07（JST）の確認時点で`1.0.3 (16)`はApp Store本番公開済み。公開日時は2026-10-06 06:27:33（JST）。以下に準備・提出時点の履歴と、その後の公開確認結果を記録する。

### 準備開始時点の方針

2026-10-05（JST）にAppleの日本向け公開lookupとApp Store Connectを再取得し、公開版が`1.0.2 (15)`、App Store stateが`READY_FOR_SALE`、Build IDが`5407229d-ef1b-47cf-8c98-60f8f1c8848e`であることを確認した。日本語対応と新画像を含む1.0.2は公開済みであり、下記の過去の審査待ち記録は現在の状態を示さない。準備開始時点ではApp Store version `1.0.3`はなく、最新upload済みbuildは`15`だった。

準備時点ではパッチ番号だけを上げた`1.0.3 (16)`を更新対象とした。準備元はmain `493ed7ea`（PR #138まで取り込み済み）。PRを人間が確認・マージした後、merge済みソースからArchiveし、Appleへのアップデート審査申請までをエージェントが担当する方針とした。一般公開の操作はユーザーが担当した。

### 今回含める変更

- レシピへ自分用のメモを追加・編集でき、詳細画面で本文を確認できる（PR #133 / #135）
- 作り方の修正・追加・削除と、つまみのドラッグによる並べ替えができる（PR #134 / #137）
- メモ画面の大きさ・全文表示の条件・保存ボタンを改善し、保存上限を200字に揃える（PR #137 / #138）
- mainに取り込まれたTikTok Lite短縮URL対応、解析失敗の診断改善、インフラ費用削減はバックエンド側の変更として扱う。iOSのArchiveだけでは稼働環境への反映を証明しない（PR #129〜#132 / #136）

日本語の更新内容案:

「レシピに自分用のメモを保存できるようになりました。作り方の編集・追加・削除や並べ替えにも対応しました。メモの表示と編集画面を使いやすく改善しました。」

App Store掲載名、インストール後の表示名、既存の日本語スクリーンショット、無料・日本限定の配信設定は維持する。審査申請前にApple側の保存済み設定を再取得し、公開方式が`MANUAL`であることを確認する。

### 準備PRのローカル検証

2026-10-05（JST）に今回の番号更新を含むソースで実行した。

- `npm run check:specs`: 46仕様すべて成功。PR差分のspec変更gateも成功
- `npm run verify`: 成功。単体454件、結合58件、E2E52件。P0 guardrail、format、lint、architecture、docs、Prisma generate / validate、buildを含む
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer IOS_PARALLEL_WORKERS=1 npm run verify:ios`: 全136件成功、失敗0、skip0（単体75件、結合27件、UI34件）。SwiftData legacy-store migration、iOS lint / format、build、日本語resource確認を含む
- ビルド済み本体とShare Extensionの両方で`1.0.3 (16)`、表示名`Foodfolio`、日本語`InfoPlist.strings`を確認
- task check、変更Markdownのformat check、`git diff --check`: 成功

最終PR HEADのQuality結果はPR上で確認する。ローカル検証の成功を、マージ、署名済みArchive、Apple提出や実機確認の証跡として扱わない。

### マージ後の確認・提出結果

2026-10-05（JST）に準備PR [#139](https://github.com/Kay-pht/foodfolio/pull/139) の人間によるマージを確認した。対象SHAは`1b0e95d01aca9da29796eb414b070a953ad302ae`で、準備PRの検証済みHEADと同一tree。mainの[Quality](https://github.com/Kay-pht/foodfolio/actions/runs/37219105651)も成功した。

- [x] merge済みソースから署名済みRelease Archive / IPAを作成。本体・Share Extensionの`1.0.3 (16)`、日本語resource、表示名、Bundle ID、App Group、本体のproduction APNs・Sign in with Apple、署名を確認
- [x] API / Workerの配信中ソース`493ed7ea9d12e378510d1c2c0a2b2583a61830df`を確認。API `foodfolio-dev-api-00052-2tz` / Worker `foodfolio-dev-worker-00056-jnj`はReady、traffic 100%。merge済みソースとBackend / Prismaの差分なし
- [x] DBの9 migrations適用済み、`20260930152000_add_recipe_memo`適用済み、未完了・rollbackなしを直接確認
- [x] Apple validation / upload成功。Build ID `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、processing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告`false`を再取得
- [x] 既存`Foodfolio Internal`への割り当て、`IN_BETA_TESTING`、日本語What to Testを再取得
- [x] 新しい審査用アカウントを作成し、Firebaseメール認証と認証済みAPIアクセス（HTTP 200）を確認。App Store・TestFlightの審査情報へ登録し、保存済み認証情報の一致を読み戻し確認。秘密情報はGitへ保存しない
- [x] App Store version `1.0.3`へbuild `16`を選択。更新内容、既存日本語metadata、連絡先、画像6枚（`APP_IPHONE_67`、すべて`COMPLETE`）、無料（JPY 0）、日本のみ、`MANUAL`を再取得
- [x] 2026-10-05 11:35（JST）にApp Reviewへ提出。Submission ID `f80cf6e3-ad26-4410-aa96-62286a4f4b21`。versionとsubmissionの両方が`WAITING_FOR_REVIEW`

App Store version IDは`35229013-f68c-4595-a000-ba8f6a517246`。提出時点では一般公開前であり、公開方式は`MANUAL`だった。今回の実機操作の再検証はエージェントでは行っておらず、ユーザーによるテスト、自動テスト、API確認、Apple提出を別の証跡として扱う。

### App Store本番の公開結果

2026-10-07（JST）にAppleの[日本向け公開lookup](https://itunes.apple.com/lookup?id=6806783378&country=jp)とApp Store Connectを読み戻し、`1.0.3 (16)`の公開を確認した。公開lookupの`currentVersionReleaseDate`は`2026-10-05T21:27:33Z`で、日本時間の公開日時は2026-10-06 06:27:33（JST）。ユーザーからも公開完了の報告を受けた。

- [x] 日本向け[App Store公開ページ](https://apps.apple.com/jp/app/id6806783378)の公開versionは`1.0.3`、Bundle IDは`com.keyukt.foodfolio`
- [x] App Store Connectのversion `1.0.3`は`READY_FOR_SALE`、選択buildは`16`、Build IDは`04094ec3-5d57-4f0d-88a8-c447acc6d6d5`。processing `VALID`、未期限
- [x] Submission ID `f80cf6e3-ad26-4410-aa96-62286a4f4b21`は`COMPLETE`。公開方式は`MANUAL`のまま
- [x] `REL-20261005-01`、`REL-20261004-02`、`REL-20261004-01`、`REL-20261003-02`、`REL-20261003-01`のApp Store本番反映を完了し、必要な反映先がすべて確認済みのため`tasks/released.md`へ移動

上記の`WAITING_FOR_REVIEW`は2026-10-05の提出時点の履歴であり、現在の審査・公開状態ではない。

## 更新 1.0.2 (15) の提出状況

2026-09-24時点で、日本向けApp Store公開版とApp Store Connectのversion `1.0.1`はいずれも公開中（`READY_FOR_SALE`）。公開ページには旧スクリーンショット3枚が掲載され、binary由来の対応言語は英語と表示されている。main `fe508d6d093d31fe33faa3d72d6081dd1f31daa9`には、日本語をdevelopment languageとして宣言し、本体とShare Extensionへ`ja.lproj/InfoPlist.strings`を含めるPR #124と、新しいApp Store画像生成元を追加するPR #125が含まれるが、どちらも次のbinaryとApp Store versionへは未反映である。

次の更新は`1.0.2 (15)`とし、以下を対象にする。

- App Store掲載名: `レシピ保存/管理アプリ - Foodfolio`
- インストール後の本体・Share Extension表示名: `Foodfolio`のまま維持
- 対応言語: 日本語。英語UI翻訳や言語選択機能は追加しない
- スクリーンショット: 利用許可を確認済みの日本語画像6枚を指定順で登録
- TestFlight: 既存の`Foodfolio Internal`と`Foodfolio External`を維持
- 価格・配信地域・カテゴリ・App Privacy: 現行設定を維持し、提出前に再取得する
- リリース方法: Apple承認後の手動公開。実行直前にユーザーの最終確認を得る

更新内容:

「App Store上で対応言語が日本語と正しく表示されるよう改善しました。」

### 新しいスクリーンショット

`npm run appstore:generate`で生成した次の6枚を、App Store Connectが受け付ける`1320 x 2868`画像として`APP_IPHONE_67`へ登録した。生成物自体はGit管理しない。

1. `01-one-place.png` — 対応するWeb・SNS・AI共有元とレシピ管理
2. `02-unlimited.png` — 無料・保存数無制限
3. `03-url.png` — URL貼り付けによる追加
4. `04-readable.png` — 材料と作り方の確認
5. `05-share.png` — Share Extensionからの保存
6. `06-want-to-cook.png` — 「作りたい」による整理

PR #125の仕様とローカル生成結果により、6枚すべて`1320 x 2868`であること、見出し・注釈・端末枠に欠けがないことを確認済み。元画像に含まれる料理写真、TikTok表示、投稿名、各サービスロゴは、ユーザーからApp Store掲載用素材としての利用許可を確認済み。

main `f0c1501e33cca924adabc1f409cce8a8c6bd791a` からRelease Archiveを作成し、Apple validationとuploadに成功した。本体とShare Extensionはともに`1.0.2 (15)`で、日本語`InfoPlist.strings`、インストール後の表示名`Foodfolio`、本体のproduction APNs・Sign in with Apple・共通App Group、Extensionの共通App Groupを確認した。App Store Connect Build IDは`5407229d-ef1b-47cf-8c98-60f8f1c8848e`で、processing `VALID`、未期限、`APP_STORE_ELIGIBLE`、暗号化申告`false`を再取得した。

App Store Connect version ID `466babf4-c636-4fe0-8511-238b7e1d2c77`を作成してbuild 15を選択した。App Store掲載名「レシピ保存/管理アプリ - Foodfolio」、日本語の更新内容、審査情報を保存し、`1320 x 2868`画像6枚はApp Store Connect APIが受け付ける`APP_IPHONE_67`へ指定順で登録した。6枚すべてasset delivery `COMPLETE`、旧`APP_IPHONE_65`画像セットは削除済み。無料、日本のみ、主カテゴリ`Food & Drink`、年齢区分、手動公開を再取得した。

2026-09-24にApp Reviewへ提出し、Submission IDは`db504a03-0150-4de4-9ecd-66b117fae1a6`。versionとsubmissionはいずれも`WAITING_FOR_REVIEW`。Apple承認後の手動公開は実施していない。

## 更新 1.0.1 (14) の提出状況

2026-09-22に日本向けApple公開lookupでversion `1.0` の配信を確認した。以下の1.0 (13) に関する審査待ち・未公開の記録は当時の記録であり、現在の公開状態を示さない。現行1.0のApp Store Connect build番号・公開日時は次回更新前に再取得する。

main `c4f85fbc0d076645c2f43655e1291647583c5c40` から `1.0.1 (14)` をArchiveし、Apple validationとuploadに成功した。Build IDは `7db14f24-ffd5-4c9f-9bdf-966b3937e711`。processing `VALID`、未期限、暗号化申告 `false` を確認した。

App Store Connect version ID `2cd5cd24-e587-400d-afaf-a24a50ba4b14` を作成し、build 14を選択した。既存の無料・日本のみ・手動公開方針、App Privacy、年齢レーティング、カテゴリ、日本語metadata、審査情報、6.5-inchスクリーンショット3枚を読み戻した。2026-09-22にApp Reviewへ提出し、Submission ID `fc385487-84a2-4fa0-b595-90b451cbdd5d`、versionとsubmissionはいずれも `WAITING_FOR_REVIEW`。Apple承認後の手動公開は未実施。

保存済みの更新内容: 「レシピの同期で端末から欠けたデータを再取得できるようにし、レシピではないURLの表示を分かりやすくしました。共有シートでは、送信中の進行状況と送信完了が分かりやすく表示されます。」

## 対象と公開方針

- アプリ: Foodfolio
- version / build: `1.0 (13)`
- 対象端末: iPhone
- 価格: 無料
- 初回配信地域: 日本のみ
- 主カテゴリ: `Food & Drink`
- 副カテゴリ: なし
- Kidsカテゴリ: 使用しない
- リリース方法: Apple承認後に手動公開
- Share Extension: 2026-09-18にiOS更新後の実機で、URL送信からレシピ追加まで正常動作を確認済み

`Food & Drink` はAppleがレシピ集や料理ガイドを例示している料理・レシピ向けカテゴリである。

## 日本語プロダクトページ文面

### サブタイトル

見つけたレシピを、ひとつの料理帳に

### 説明

Foodfolioは、WebやSNSで見つけた公開レシピを保存し、材料や作り方を整理できる自分だけのレシピ帳です。

公開されているレシピURLを追加すると、元ページや対応コンテンツをAIで解析し、料理名、材料、分量、調理時間、ジャンル、手順を見やすくまとめます。公開されたChatGPTまたはGeminiの共有会話に含まれるレシピも保存できます。

主な機能

- 公開レシピURLの保存とAI解析
- 材料・作り方をFoodfolio内で確認
- レシピの検索、編集、削除
- タグと「作りたい」による整理
- 保存済みレシピの端末間同期
- 解析完了・失敗時のPush通知
- Apple、Google、メールによるログイン
- アプリ内からのアカウントと関連データの削除

AIによる解析結果には誤りや不足が含まれる場合があります。調理前に、必ず元のレシピを確認してください。

### キーワード

レシピ,料理,料理帳,レシピ保存,献立,材料,作り方,検索,タグ,クッキング,自炊,AI

### URLと権利情報

- サポートURL: `https://foodfolio-af28aa.web.app/support`
- プライバシーポリシーURL: `https://foodfolio-af28aa.web.app/privacy`
- Marketing URL: 未設定（任意項目）
- Copyright: `2026 Keisuke Yasuda`
- 第三者コンテンツ: 使用する。利用者が適法に利用できる公開URLを指定する前提とし、元ページへのリンクを保持する

## App Privacy公開内容

回答はFoodfolio本体、組み込みSDK、現在利用するBackendを合わせて申告した。追跡は行わず、広告目的には使用しない。2026-09-16にApp Store Connectへ公開し、画面上で公開済み表示とプロダクトページプレビューを確認した。

| Appleのデータ種別                   | ユーザーへの紐付け | Tracking | 利用目的                     | 根拠                                                                                       |
| ----------------------------------- | ------------------ | -------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Contact Info / Name                 | あり               | なし     | App Functionality            | Apple / Google認証で取得し得る氏名・プロフィール情報                                       |
| Contact Info / Email Address        | あり               | なし     | App Functionality            | Firebase Authentication、メールログイン、審査用アカウント                                  |
| Contact Info / Phone Number         | あり               | なし     | App Functionality            | Google Sign-In 9.2.0のPrivacy Manifest                                                     |
| Location / Coarse Location          | あり               | なし     | App Functionality            | Google Sign-In 9.2.0のPrivacy Manifest。GPS等の正確な位置情報ではない                      |
| Identifiers / User ID               | あり               | なし     | App Functionality、Analytics | Foodfolio User ID、Firebase UID、認証Provider ID、Google Sign-In 9.2.0のPrivacy Manifest   |
| Identifiers / Device ID             | あり               | なし     | App Functionality、Analytics | FCM token、APNs token、アプリのインストールID、Google Sign-In 9.2.0のPrivacy Manifest      |
| User Content / Other User Content   | あり               | なし     | App Functionality            | 保存URL、レシピ、材料、手順、タグ、生成画像                                                |
| Usage Data / Other Usage Data       | あり               | なし     | Analytics                    | Google Sign-In 9.2.0のPrivacy Manifest                                                     |
| Other Data / Other Data Types       | あり               | なし     | App Functionality、Analytics | Google Sign-In 9.2.0とFirebase Messaging 12.18.0のPrivacy Manifest                         |
| Diagnostics / Other Diagnostic Data | なし               | なし     | App Functionality、Analytics | Firebase Auth、Messaging、Installations 12.18.0のPrivacy ManifestとBackendの非識別運用ログ |

次は収集しない。

- 正確な位置情報
- 支払情報
- 連絡先アドレス帳
- Health / Fitness情報
- 広告データ
- Tracking目的のデータ
- Firebase Analytics / Crashlyticsのデータ

公式SDK開示との照合結果:

- Firebase Authenticationは認証用識別子を常時生成・保存し、利用形態に応じて氏名・メールアドレス等を扱う。
- Firebase MessagingはAPNs token、FCM登録tokenとなるインストールID、端末モデル、言語、タイムゾーン、OS・アプリ情報を扱う。
- Google Sign-In 9.2.0の組み込みPrivacy Manifestは、氏名、メールアドレス、電話番号、概算位置情報、User ID、Device ID、Other Usage Data、Other Data Typesを申告する。Trackingはいずれもfalseで、用途はApp FunctionalityまたはAnalyticsである。
- Firebase Auth、Messaging、Installations 12.18.0の組み込みPrivacy ManifestはUser ID、Device ID、Other Data Types、Other Diagnostic Dataを申告する。Trackingはいずれもfalseである。
- Firebase AnalyticsとFirebase Crashlyticsはtargetへ含めていない。

## 年齢レーティング回答案

FoodfolioはKidsカテゴリへ登録せず、年齢の上方overrideを設定しない。現行実装には広告、アプリ内チャット、ユーザー間交流、ギャンブル、課金、Loot Box、成人向け機能、医療機能、暴力表現を目的とする機能はないため、該当するコンテンツ頻度は `NONE` とする。

- Parental Controls: なし
- Age Assurance: なし
- Messaging and Chat: なし
- Social Media機能: なし
- User Generated Contentの公開・共有機能: なし
- Unrestricted Web Access: なし。任意URLをブラウズするWebブラウザではなく、利用者が指定した公開URLをレシピとして解析し、元URLは必要時に外部ページとして開く
- Advertising: なし
- Health or Wellness Topics: なし
- Medical or Treatment Information: なし
- Contests / Gambling / Simulated Gambling / Loot Box: なし
- Alcohol, Tobacco, Drug、性的表現、恐怖、暴力、武器、粗野な表現: なし

## App Review Information

審査連絡先と審査用メールアカウントは、外部TestFlight審査で確認済みの値を再利用する。認証情報はリポジトリへ記録しない。

### Review Notes

Foodfolio is a Japanese recipe organizer for iPhone running iOS 26 or later. Sign in with the review account using the email sign-in option. Apple and Google sign-in are also supported.

Save a public recipe URL using the Add button inside the app. The app analyzes public source content using external AI services and displays extracted ingredients and instructions. Public ChatGPT and Gemini shared-conversation URLs are also supported. Foodfolio account identifiers such as the app user ID, Firebase UID, email address, authentication token, and push-notification token are not included in the Z.ai, Google Gemini, or OpenAI content-generation requests. Public source content may contain publisher information. Please verify AI-generated results against the original source.

Enable notifications to receive analysis-completion or failure alerts. Recipes can be searched, edited, tagged, and marked as recipes the user wants to cook. Account deletion is available in the Account screen and removes the account and associated Foodfolio data. No purchase or subscription is required.

On September 18, 2026, the Share Extension was reverified on a physical device after updating iOS, and URL submission completed normally.

## スクリーンショット

日本語の6.5-inch iPhone表示として、build 13と同じUIから次を作成した。3枚とも`1242 x 2688`で、App Store Connectの`APP_IPHONE_65`へ登録し、asset delivery stateが`COMPLETE`であることを確認した。テスト用の架空データだけを使用し、認証情報や利用者データは含めていない。

1. ホーム: 保存レシピの一覧
2. レシピ詳細: 料理名、ジャンル、調理時間、人数、タグ、材料、手順
3. 検索: 料理名・材料検索とタグ／ジャンル絞り込み

## 2026-09-16 時点の確認結果

### App Store Connectで保存・読み戻し済み

- version `1.0`へbuild `13`を選択
- build 13は`VALID`、未期限、`APP_STORE_ELIGIBLE`、`usesNonExemptEncryption: false`
- 主カテゴリ`FOOD_AND_DRINK`、副カテゴリなし、Kidsカテゴリなし
- 日本語サブタイトル、説明、キーワード、サポートURL、プライバシーポリシーURL、Copyright
- 第三者コンテンツを使用する旨の宣言
- 年齢レーティング必須回答は未回答なし。User Generated ContentとUnrestricted Web Accessはいずれもfalse
- 価格は無料、基準地域・通貨は日本・JPY
- 配信地域は日本のみ。Japanは`available: true`、他地域は`available: false`、新規地域への自動追加はfalse
- Apple Silicon MacとApple Vision Proでの配信は無効
- リリース方法はApple承認後の手動公開
- 審査連絡先、審査用アカウント、Review Notes（2026-09-16提出時点ではShare Extension既知制限を含む旧文面。2026-09-18の実機再確認後は上記推奨文面との差分がある）
- 6.5-inch iPhoneスクリーンショット3枚
- App Privacyは上記10データ種別を公開済み。画面上で`Published`表示、Linked / Not Linkedのプレビュー、各利用目的を読み戻した
- version `1.0 (13)`をApp Reviewへ提出済み。Submission IDは`2b364edb-27d0-4981-8c9b-25911c1dcb4e`、状態は`Waiting for Review`

### ローカル検証

- `npm run check:specs`: 20仕様すべて成功
- `npm run check:docs`: 成功
- `npm run format:check`: 成功
- `npm run verify`: 成功。unit 277件、integration 49件、E2E 34件を含む
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer IOS_PARALLEL_WORKERS=1 npm run verify:ios`: 110件成功、失敗0、skip 0

### 残存確認と今後の操作

- 2026-09-18にiOS更新後の実機でShare Extensionを再確認し、共有画面の表示とURL送信からレシピ追加まで正常に完了することを確認した
- build 13の認証、ChatGPT/Gemini取込、生成画像、Push、検索などShare Extension以外の未確認項目は `tasks/todo.md` で引き続き管理する
- App Store Connectへ2026-09-16に提出したReview NotesにはShare Extensionの既知制限を含む旧文面が残っている。このソースPRだけではApple側の保存済み文面は変更されない
- App Review提出は完了し、Appleの審査待ち。Appleから問い合わせまたはリジェクトが届いた場合は対応が必要
- 承認後の一般公開は未実施。手動公開の実行直前にユーザー確認を必要とする

## 審査中・公開前の停止条件

- `npm run verify` または `npm run verify:ios` が失敗・skipした場合
- build 13が`VALID`かつ未期限でなくなった場合
- 必須メタデータ、build、App Privacy、年齢レーティング、価格、地域、審査情報、スクリーンショットの再取得が一致しない場合
- 審査用アカウントでログインできない場合
- Appleの契約・規約同意、地域固有情報、または権限不足が表示された場合
- 承認後の一般公開について実行直前のユーザー確認がない場合
