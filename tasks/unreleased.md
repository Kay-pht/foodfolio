# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260910-01` Share Extensionの標準Postと送信結果表示を修正する
  - 内容: 共有URLの非同期取得後に `SLComposeServiceViewController` のcontent validationを更新し、標準Postを有効化する。Post / Cancelはシステム標準へ統一する。Backendが追加を受理した場合は成功ダイアログを表示し、利用者が確認してから閉じる。重複・受付上限・認証・不正URL・通信・その他の失敗理由を区別し、一時的な通信・サーバー失敗だけ再試行を表示する。Share ExtensionはFoodfolio本体と同じLight外観に統一する。
  - PR: [#88](https://github.com/Kay-pht/foodfolio/pull/88)
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: 未定
  - 備考: 実機で発生しているShare Extensionの全面blank/black画面の原因調査と修正は別タスクとして残す。

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
