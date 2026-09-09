# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260909-03` 画像再取得で初回解析と同じ代表画像解決を使用する
  - 内容: 端末内の保存画像と保存済み画像URLの両方から画像を復旧できない場合に、Backendが初回解析と同じ媒体別ロジックで代表画像URLを再解決する。LinkPresentationのプレビュー画像は使用せず、再取得画像にも通常の中央拡大・トリミングを適用する。
  - PR: [#84](https://github.com/Kay-pht/foodfolio/pull/84)
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: 未定
    - [ ] Cloud Run（現在利用中のdev） — 対象version/revision: 未定
  - 備考: Cloud Run APIで既存の `foodfolio-dev-youtube-api-key` Secretを参照できることをBackend反映前に確認する。

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
