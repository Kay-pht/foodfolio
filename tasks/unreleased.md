# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260918-01` Share Extensionの送信表示を一般向けにする
  - 内容: Post後は「確認中」とスピナーを表示し、成功時は「✓ 送信」と表示する。利用者向けUIから「Backend」という内部用語を削除する
  - PR: #110
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: 未定
    - [ ] App Store本番 — 対象version/build: 未定
  - 備考: 2026-09-18にiOS更新後の実機でShare Extension自体の正常動作は確認済み。本項目は機能修正ではなく表示改善

- [ ] `REL-20260915-02` Foodfolio 1.0をApp Storeで初回公開する
  - 内容: 外部TestFlightで承認済みのFoodfolio 1.0 build 13を、無料のiPhoneアプリとして日本のApp Storeへ公開する。主カテゴリはFood & Drink、副カテゴリなし、Apple承認後は手動公開とする。Share Extensionは2026-09-18にiOS更新後の実機でURL送信からレシピ追加まで正常動作を確認済み
  - PR: #107
  - main反映: 未反映
  - 必要な反映先:
    - [ ] App Store本番 — 対象version/build: `1.0 (13)`
  - 備考: 2026-09-16にApp Privacyを公開し、`1.0 (13)`をApp Reviewへ提出済み（Submission ID `2b364edb-27d0-4981-8c9b-25911c1dcb4e`、`Waiting for Review`）。Apple承認後の一般公開は、実行直前に状態を再取得し、ユーザー確認後に行う

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
