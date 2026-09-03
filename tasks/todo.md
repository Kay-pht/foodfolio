# Foodfolio TODO

- [ ] 複数ページに分割された一般Webレシピを、安全に取得・解析できるようにする
  - 貼り付けられたページを先に解析し、材料・作り方が不足する場合だけ前後ページを取得候補にする
  - 同一記事・同一レシピの続きと確認できるページだけを、ページ境界を保持してAIへ渡す。複数レシピや判定が曖昧な場合は結合しない
  - 材料・作り方が不足するJSON-LDでは本文も解析対象とし、解析後も不足する場合は `completed` にしない
  - 単一ページ、途中ページからの取得、同一レシピの分割、ページごとに別レシピがある記事、循環リンク・上限到達をテストする
- [ ] TikTokタイトル不足時の動画フォールバックをdevへ反映し、実アプリで許可済みURLを検証
- [ ] TestFlightリリース準備
  - 環境方針: 初期TestFlightでは独立したProduction環境を構築せず、現在のバックエンド環境を利用する。利用者数や運用上の必要性が生じた段階で、Production環境の分離を再検討する
  - [ ] Apple側の利用資格と登録を完了する
    - [x] Apple Developer Programへの加入、最新規約への同意、MFAを完了する（ユーザー作業）
    - [x] Apple DeveloperのTeam IDを確認し、Xcodeの署名用アカウントを登録する（ユーザー作業）
    - [x] App Store Connectに、アプリ名 `Foodfolio - あなたのレシピ帳`、Bundle ID `com.keyukt.foodfolio`、SKU、主言語を設定したアプリレコードを作成する（ユーザー作業）
    - [x] App ID `com.keyukt.foodfolio` でSign in with AppleとPush Notificationsを有効化する（ユーザー作業）
    - [ ] XcodeのReleaseビルドをFoodfolioのTeamとDistribution用プロビジョニングで署名できる状態にする
  - [ ] TestFlight用の認証を設定・検証する
    - [ ] Firebase iOS AppのBundle ID、`GoogleService-Info.plist`、URL SchemeがReleaseビルドと一致することを確認する
    - [ ] Apple / Google / メール認証とアカウント削除の主要分岐を自動テストする
    - [ ] Release相当の実機ビルドでApple / Google / メールの正常系を各1回確認する
    - [ ] Release相当の実機ビルドで、Apple token失効とFoodfolio側データ削除を含むアカウント削除を1回確認する
  - [ ] TestFlight用のPush通知を設定・検証する
    - [x] APNs認証キーをApple Developerで発行し、Key IDとTeam IDとともにFirebase Cloud Messagingへ登録する（秘密鍵の発行・登録はユーザー作業）
    - [ ] Release署名時に配布用APNs entitlementが付与され、実機のFCM tokenが現在利用するAPIへ登録されることを確認する
    - [ ] 実機で解析成功通知と解析失敗通知を受信し、通知タップで対象レシピが開くことを確認する
    - [ ] アプリ内の解析通知がOFFの場合は成功・失敗の両方を通知せず、ONの場合は両方を通知することを確認する
    - [ ] ログアウトとアカウント削除後に端末tokenが解除され、その利用者へ通知されないことを確認する
  - [ ] 初回TestFlightで省略するFirebase Analytics / CrashlyticsをiOS targetの依存から外し、Archiveに含まれないことを確認する
  - [ ] プライバシー・法務情報を確定する
    - [ ] 取得・保存・外部送信するデータを棚卸しする（認証ID・メール、保存URL・レシピ、検索履歴、端末token）
    - [ ] Firebase、GCP、Neon、Z.ai、YouTube、Apple、Googleへのデータ送信内容と目的を整理する
    - [ ] データの保存期間、ユーザーによる削除方法、問い合わせ先、安全管理、外部URL解析について記載したプライバシーポリシーを作成する
    - [ ] プライバシーポリシーをHTTPSの公開URLで掲載し、アプリ内とApp Store Connectの双方から到達できるようにする
    - [x] 独自利用規約は作成せず、Apple標準EULAを使用する
    - [ ] App Store ConnectのApp Privacyで、Foodfolio本体と組み込みSDKが収集するデータ、利用目的、ユーザーとの紐付け、トラッキング有無を正しく回答する
    - [ ] XcodeのPrivacy Reportと使用APIを確認し、Foodfolio本体に必要な `PrivacyInfo.xcprivacy` を作成してArchiveに含める
  - [ ] アプリの配布用表示とメタデータを用意する
    - [ ] 正式なApp Iconを全必須サイズでAssetsへ登録し、Archive検証で欠落警告がないことを確認する
    - [ ] アプリ名 `Foodfolio`、version、build number、Minimum Deployment Target、対応端末を確定する
    - [ ] 外部TestFlightで必須のBeta App Description、Feedback Email、What to Test、審査連絡先、ログイン方法、審査用アカウントまたは登録手順だけを最小限の文面で用意する
    - [ ] プライバシーポリシーURLとサポートURLをApp Store Connectへ登録する
    - [ ] HTTPS通信等の暗号利用を棚卸しし、App Store Connectの輸出コンプライアンス質問へ回答する。免除を宣言できる場合のみInfo.plistへ適切な設定を追加する
  - [ ] TestFlight buildを作成して内部テストする
    - [ ] Release構成で実装部分のテスト、全体テスト、結合テスト、E2E、lint、format check、buildを実行し、`npm run verify` を含む全検証を成功させる
    - [ ] 実機で新規インストール、URL保存、AI解析、同期、検索、Push通知の主要フローを各1回スモークテストする（認証とアカウント削除は上記の最小範囲で別途確認する）
    - [ ] XcodeでGeneric iOS Device向けArchiveを作成し、Validate Appで署名、entitlement、アイコン、Privacy Manifestのエラーがないことを確認する
    - [ ] ArchiveをApp Store Connectへuploadし、build processing完了後にエラー・警告・Missing Complianceが残っていないことを確認する
    - [ ] App Store Connectで内部テスターグループを作成し、内部テスターの実機でインストール、起動、現在利用するバックエンドへの接続、主要フローをスモークテストする
  - [ ] 外部TestFlight審査へ提出できる状態にする
    - [ ] 外部テスターグループを作成し、対象buildと「テストしてほしいこと」を設定する
    - [ ] TestFlight Test InformationとBeta App Review Informationの必須項目をすべて入力する
    - [ ] 対象buildをTestFlight App Reviewへ提出し、承認または指摘対応の完了を確認する
    - [ ] 承認済みbuildが外部テスターへ配布可能であることを確認する（実際の招待・配布は次の「MVPリリース・ユーザー検証」で行う）
  - [ ] 上記の全子タスクが完了し、証跡を確認した後にのみ「TestFlightリリース準備」を完了にする
- [ ] MVPリリース・ユーザー検証

<!-- - [ ] タイトルがそのまま過ぎて長い。タコライスならタコライスとだけ表示して欲しい。現在は【【つどいごはん】地産地消タコライス】のようにかなり長くてリスト状態の時に表示に収まりきっていない。 -->

<!-- - [ ] 材料名がそのまますぎる。 -->

- [ ] 言語対応
- [ ] 共有時にこのアプリにリンクをシェアする
- [ ] 材料の量がたまに表示されなくなる
