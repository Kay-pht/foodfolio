# App Store 初回リリース準備

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
- Share Extension: build 13の既知制限として審査情報へ明記し、アプリ内の追加ボタンを代替手順とする

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

## App Privacy回答案

回答はFoodfolio本体、組み込みSDK、現在利用するBackendを合わせて申告する。追跡は行わず、広告目的には使用しない。

| Appleのデータ種別 | ユーザーへの紐付け | Tracking | 利用目的 | 根拠 |
| --- | --- | --- | --- | --- |
| Contact Info / Name | あり | なし | App Functionality | Apple / Google認証で取得し得る氏名・プロフィール情報 |
| Contact Info / Email Address | あり | なし | App Functionality | Firebase Authentication、メールログイン、審査用アカウント |
| Identifiers / User ID | あり | なし | App Functionality | Foodfolio User ID、Firebase UID、認証Provider ID |
| Identifiers / Device ID | あり | なし | App Functionality | FCM token、APNs token、アプリのインストールID |
| User Content / Other User Content | あり | なし | App Functionality | 保存URL、レシピ、材料、手順、タグ、生成画像 |
| Diagnostics / Other Diagnostic Data | なし | なし | App Functionality | Firebase SDKの品質維持用メタデータとBackendの非識別運用ログ。App Store Connectの設問定義に照らして最終確認する |

次は収集しない。

- 正確な位置情報
- 電話番号
- 支払情報
- 連絡先アドレス帳
- Health / Fitness情報
- 広告データ
- Tracking目的のデータ
- Firebase Analytics / Crashlyticsのデータ

公式SDK開示との照合結果:

- Firebase Authenticationは認証用識別子を常時生成・保存し、利用形態に応じて氏名・メールアドレス等を扱う。
- Firebase MessagingはAPNs token、FCM登録tokenとなるインストールID、端末モデル、言語、タイムゾーン、OS・アプリ情報を扱う。
- Google Sign-InはOAuth grant用のUser IDと、不正防止のためIPアドレスを扱う場合がある。
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

Known limitation in build 13: the Share Extension may open without completing URL submission on a physical device. Please use the Add button inside the main app during review. This limitation does not affect the in-app recipe import flow.

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
- リリース方法は`AFTER_APPROVAL`
- 審査連絡先、審査用アカウント、Review Notes
- 6.5-inch iPhoneスクリーンショット3枚

### ローカル検証

- `npm run check:specs`: 20仕様すべて成功
- `npm run check:docs`: 成功
- `npm run format:check`: 成功
- `npm run verify`: 成功。unit 277件、integration 49件、E2E 34件を含む
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer IOS_PARALLEL_WORKERS=1 npm run verify:ios`: 110件成功、失敗0、skip 0

### 未完了・ユーザー対応が必要

- App Privacy回答は未入力。公開直前に回答内容を再提示し、ユーザー確認後に保存・公開する
- 実機が接続されていないため、build 13の実機更新、認証、URL追加、ChatGPT/Gemini取込、生成画像、Push、検索の実機確認は未実施
- Share Extensionはユーザー承認済みの既知制限として実機合格条件から除外し、審査情報に代替手順を記載済み
- App Review提出と、承認後の一般公開は未実施。どちらも実行直前のユーザー確認を必要とする

## 提出前の停止条件

- `npm run verify` または `npm run verify:ios` が失敗・skipした場合
- build 13が`VALID`かつ未期限でなくなった場合
- 必須メタデータ、build、App Privacy、年齢レーティング、価格、地域、審査情報、スクリーンショットの再取得が一致しない場合
- 審査用アカウントでログインできない場合
- Appleの契約・規約同意、地域固有情報、または権限不足が表示された場合
- App Privacy公開、App Review提出、一般公開について実行直前のユーザー確認がない場合
