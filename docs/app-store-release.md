# App Store リリース管理

## 更新 1.0.2 (15) の準備方針

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

`npm run appstore:generate`で生成した次の6枚を、App Store Connectが受け付ける`1320 x 2868`画像として登録する。登録先のscreenshot display typeは、アップロード前にApp Store Connectがversion `1.0.2`へ返す有効なセットを取得して確定する。生成物自体はGit管理しない。

1. `01-one-place.png` — 対応するWeb・SNS・AI共有元とレシピ管理
2. `02-unlimited.png` — 無料・保存数無制限
3. `03-url.png` — URL貼り付けによる追加
4. `04-readable.png` — 材料と作り方の確認
5. `05-share.png` — Share Extensionからの保存
6. `06-want-to-cook.png` — 「作りたい」による整理

PR #125の仕様とローカル生成結果により、6枚すべて`1320 x 2868`であること、見出し・注釈・端末枠に欠けがないことを確認済み。元画像に含まれる料理写真、TikTok表示、投稿名、各サービスロゴは、ユーザーからApp Store掲載用素材としての利用許可を確認済み。

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
