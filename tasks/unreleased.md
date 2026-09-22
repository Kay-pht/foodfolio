# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260918-01` Share Extensionの送信表示を一般向けにする
  - 内容: Post後は「確認中」とスピナーを表示し、成功時は「✓ 送信」と表示する。利用者向けUIから「Backend」という内部用語を削除する
  - PR: #110
  - main反映: `c79ea33760057063464055c504a1560453667904`（PR #110）
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0.1 (14)`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
  - 備考: 2026-09-18にiOS更新後の実機でShare Extension自体の正常動作は確認済み。本項目は機能修正ではなく表示改善

- [ ] `REL-20260922-01` Foodfolio 1.0.1でmainの変更を配布する
  - 内容: build 13以後のmainに含まれるレシピ同期の欠損修復、解析結果`not_recipe`対応、Jev経路の設定・判定、およびShare Extensionの表示改善を1.0.1 (14)へ含める。Jevの実使用はデプロイ済み設定で確認する
  - PR: 未作成
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0.1 (14)`
    - [ ] TestFlight外部テスト — 対象version/build: `1.0.1 (14)`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
    - [ ] Cloud Run（dev API / Worker） — 対象version/revision: 要再確認
  - 備考: 公開中のversion 1.0はAppleの公開lookupで確認。App Store Connectのbuild番号と新version枠は配布前に再取得する。backend migration・Secret・Ready・trafficの確認、署名済みbuildのupload、TestFlight審査、App Review、手動公開はPRマージ後の別段階で記録する

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
