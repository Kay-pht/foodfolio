# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20261024-03` Foodfolio 1.0.5 (18)をAppleへアップデート申請する
  - 内容: 公開中の1.0.4 (17)からパッチ番号を上げ、PR #149のShare Extension表示修正を含むmain `3eff7064051086e5d6d784d5ef327ae988daf480` を配布対象とする
  - PR: [#151](https://github.com/Kay-pht/foodfolio/pull/151)（Draft）
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0.5 (18)`、upload未実施
    - [ ] App Store本番 — 対象version/build: `1.0.5 (18)`、Apple申請未実施。公開方式MANUAL、一般公開は人間が行う
  - 備考: 成功済みの実機・unit 560件・結合73件・E2E70件・iOS139件・lint・format・build・最終CIはPR #149の証跡を利用し再実行しない。準備PRの人間によるマージ後に新しい配布用Archive・upload・審査申請を進める。詳細は `docs/app-store-release.md`
- [ ] `REL-20261024-01` TikTok動画のoEmbedに画像がない場合もサムネイルを補完する
  - 内容: 投稿ページ内の対象動画カバーを取得し、初回解析と保存済みレシピの画像再取得で共用する。画像取得に失敗しても材料・作り方の解析成功を維持する
  - PR: [#150](https://github.com/Kay-pht/foodfolio/pull/150)
  - 必要な反映先:
    - [ ] Cloud Run（dev API / Worker）
  - 備考: iOS変更・DB migration・既存Recipe再解析は不要。調査証跡は `docs/image-recovery.md` に記録。利用者端末での表示確認はデプロイ後に行う
- [ ] `REL-20261024-01` Share Extensionの初期表示時の白画面を修正する
  - 内容: 標準共有UIの表示完了前に本文の入力経路を無効化しない。表示途中のユーザー編集は拒否し、表示完了後に読み取り専用へ切り替える。明示的なPost確認と既存の送信処理を維持する
  - PR: [#149](https://github.com/Kay-pht/foodfolio/pull/149)
  - main反映: `3eff7064051086e5d6d784d5ef327ae988daf480`（PR #149）
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0.5 (18)`
    - [ ] App Store本番 — 対象version/build: `1.0.5 (18)`。一般公開は人間が行う
  - 備考: 実機診断用のローカルインストールと、配布用buildへの反映は別に管理する

- [ ] `REL-20261016-03` Foodfolio 1.0.4をAppleへアップデート申請する
  - 内容: 公開中の1.0.3 (16)からパッチ番号を上げ、本体・Share Extensionを1.0.4 (17)にする。準備元はmain `8e75ea7c`。前回配布元からiOSコードの変更はなく、解析改善はWorkerの反映と別に確認する
  - PR: [#146](https://github.com/Kay-pht/foodfolio/pull/146)
  - main反映: `ada391b7bae7a12375706a84c6f5d1ffaf6ac5a2`（PR #146）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-16`、version: `1.0.4 (17)`、Build ID: `1471a727-5c5e-4289-a7d5-4e859558c153`、group: `Foodfolio Internal`、`IN_BETA_TESTING`
    - [ ] App Store本番 — 対象version/build: `1.0.4 (17)`、version ID: `2f6cf146-1e86-423b-b9de-68c2402835f5`、Submission ID: `dd746f85-c5bf-4e62-a2d1-ae56ba3fd3f1`、2026-10-16 21:00:33（JST）に提出、`WAITING_FOR_REVIEW`。`MANUAL`を維持し、公開はユーザーが行う
  - 備考: 今回のゴールであるApple申請まで完了。準備PRの人間によるマージ後、署名済みArchive・Apple validation / upload・processing `VALID`・内部配布・審査提出を確認した。Workerは既存自動デプロイの成功・配信先を確認済み。PR #142の監視Terraform適用は別管理。各解析改善の配布状況は既存項目で追跡する

- [ ] `REL-20261007-02` 分析最終失敗のSlackアラートに分析対象URLを添付する
  - 内容: 認証情報・fragment・許可していないクエリを除去したリンクを表示し、YouTubeは検証済み動画IDを維持する。不正URL時は固定の取得不可文を表示する。整形後URLと他の抽出ラベルの組み合わせごとに通知し、同じ組み合わせの繰り返し通知は1時間に1回までに抑える（Cloud Monitoringのサービス上限内）
  - PR: [#142](https://github.com/Kay-pht/foodfolio/pull/142)
  - main反映: `fc67b1fa`（PR #142）
  - 必要な反映先:
    - [x] Cloud Run（dev Worker） — 反映日: `2026-10-16`、SHA: `8e75ea7c1b2042a50ab7ca9ffd8714d51064fd11`、revision: `foodfolio-dev-worker-00060-jss`、Ready、traffic 100%、digest: `sha256:567f8b34a417f9a44935b009127d0568cf9acc805649a0cce152c0170aabd587`、[自動デプロイ・照合成功](https://github.com/Kay-pht/foodfolio/actions/runs/38870286716)
    - [ ] GCP runtime monitoring — 既存Recipe Analysis最終失敗policyへ `source_link` の抽出と通知本文を反映
  - 備考: 今回の依頼範囲はコード変更・検証・PR作成まで。Workerは後続の既存自動デプロイで反映済み。Terraform適用、実Slack通知確認は未実施

- [ ] `REL-20260924-01` Foodfolio 1.0.2で日本語表示情報とApp Store掲載内容を更新する
  - 内容: iOS本体とShare Extensionが日本語対応アプリであることをAppleへ正しく申告し、インストール後のアプリ名は`Foodfolio`のまま維持する。App Store上の表示名を「レシピ保存/管理アプリ - Foodfolio」へ変更し、利用許可を確認済みの新しい日本語マーケティング画像6枚へ差し替える。あわせて、PR #121/#122でmainへ追加した5つのCloud Monitoring alert policyを既存Slack通知先へ反映する
  - PR: 日本語申告 [#124](https://github.com/Kay-pht/foodfolio/pull/124)、App Store画像 [#125](https://github.com/Kay-pht/foodfolio/pull/125)、Runtime Monitoring [#121](https://github.com/Kay-pht/foodfolio/pull/121) / [#122](https://github.com/Kay-pht/foodfolio/pull/122)、配布準備 [#126](https://github.com/Kay-pht/foodfolio/pull/126)、配布記録 [#128](https://github.com/Kay-pht/foodfolio/pull/128)
  - main反映: `f0c1501e33cca924adabc1f409cce8a8c6bd791a`（PR #126）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-24`、version: `1.0.2 (15)`、Build ID: `5407229d-ef1b-47cf-8c98-60f8f1c8848e`、group: `Foodfolio Internal`
    - [ ] TestFlight外部テスト — 対象version/build: `1.0.2 (15)`、既存`Foodfolio External`へ割り当て済み、Beta App Review `WAITING_FOR_REVIEW`
    - [ ] App Store本番 — 対象version/build: `1.0.2 (15)`、version ID: `466babf4-c636-4fe0-8511-238b7e1d2c77`、Submission ID: `db504a03-0150-4de4-9ecd-66b117fae1a6`、App Review `WAITING_FOR_REVIEW`、Apple承認後に手動公開
    - [x] GCP runtime monitoring — 反映日: `2026-09-24`、project: `foodfolio-af28aa`、既存5 alert policiesを`0 add / 5 update / 0 destroy`で更新し、既存Slack notification channel `#foodfolio-alerts`への紐付け、日本語subject、Recipe Analysisの8つの非機密label extractorをAPIで再取得
  - 備考: Release Archive、Apple validation、upload、processing `VALID`、内部・外部group割り当て、What to Test保存、App Store掲載名・更新内容・審査情報、`APP_IPHONE_67`の新画像6枚、無料・日本限定・Food & Drink・年齢区分を再取得した。`CFBundleDisplayName`と`CFBundleName`は本体・Share Extensionとも`Foodfolio`を維持し、英語UI翻訳と言語選択機能は対象外。公開直前にユーザーの最終確認を行う。監視反映では意図的な障害・OOM・最終失敗を発生させていないため、実Slack通知の発火確認は実施していない

- [ ] `REL-20260918-01` Share Extensionの送信表示を一般向けにする
  - 内容: Post後は「確認中」とスピナーを表示し、成功時は「✓ 送信」と表示する。利用者向けUIから「Backend」という内部用語を削除する
  - PR: #110
  - main反映: `c79ea33760057063464055c504a1560453667904`（PR #110）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-22`、version: `1.0.1 (14)`、Build ID: `7db14f24-ffd5-4c9f-9bdf-966b3937e711`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
  - 備考: 2026-09-18にiOS更新後の実機でShare Extension自体の正常動作は確認済み。本項目は機能修正ではなく表示改善

- [ ] `REL-20260922-01` Foodfolio 1.0.1でmainの変更を配布する
  - 内容: build 13以後のmainに含まれるレシピ同期の欠損修復、解析結果`not_recipe`対応、Jev経路の設定・判定、およびShare Extensionの表示改善を1.0.1 (14)へ含める。Jevの実使用はデプロイ済み設定で確認する
  - PR: #119
  - main反映: `c4f85fbc0d076645c2f43655e1291647583c5c40`（PR #119）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-22`、version: `1.0.1 (14)`、Build ID: `7db14f24-ffd5-4c9f-9bdf-966b3937e711`、group: `Foodfolio Internal`
    - [ ] TestFlight外部テスト — 対象version/build: `1.0.1 (14)`、`Foodfolio External`へ割り当て済み、Beta App Review `WAITING_FOR_REVIEW`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
    - [x] Cloud Run（dev API / Worker） — 確認日: `2026-09-22`、version: `fe56f2cf30e322a55af2e093495e510d4bff009c`、API `foodfolio-dev-api-00041-cbd` / Worker `foodfolio-dev-worker-00045-gvp`、Ready、traffic 100%
  - 備考: App Store Connect version 1.0.1へbuild 14を選択し、App Reviewへ提出済み。Submission ID `fc385487-84a2-4fa0-b595-90b451cbdd5d`、`WAITING_FOR_REVIEW`。Apple承認後の手動公開は未実施

- [ ] `REL-20260915-02` Foodfolio 1.0をApp Storeで初回公開する
  - 内容: 外部TestFlightで承認済みのFoodfolio 1.0 build 13を、無料のiPhoneアプリとして日本のApp Storeへ公開する。主カテゴリはFood & Drink、副カテゴリなし、Apple承認後は手動公開とする。Share Extensionは2026-09-18にiOS更新後の実機でURL送信からレシピ追加まで正常動作を確認済み
  - PR: #107
  - main反映: `60a77bdcd8fd62c0c1d934f2cc4d713ea1d437ce`（PR #107）
  - 必要な反映先:
    - [ ] App Store本番 — 対象version/build: `1.0 (13)`
  - 備考: 2026-09-16にApp Privacyを公開し、`1.0 (13)`をApp Reviewへ提出した記録（Submission ID `2b364edb-27d0-4981-8c9b-25911c1dcb4e`、当時 `Waiting for Review`）。2026-09-22にAppleの日本向け公開lookupでversion `1.0` の配信を確認した。公開されたbuild IDと公開日時のApp Store Connect再取得が残るため、反映済みチェックとreleasedへの移動は保留する

## 追加時の書式

<!--
- [ ] `REL-YYYYMMDD-NN` 機能名
  - 内容: 利用者または実行環境に生じる変更
  - PR: 未作成
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: 未定
    - [ ] App Store本番 — 対象version/build: 未定
    - [ ] Cloud Run（環境名） — 対象version/revision: 未定
  - 備考: 任意
-->
