# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260909-02` 欠損したレシピ画像を元URLから復旧する
  - 内容: 保存済みの画像URLから表示できない場合に、元レシピURLの代表画像を取得して端末内へキャッシュする。端末内キャッシュ、保存済み画像URL、元URL、既定プレースホルダーの順で表示を試み、同期時のキャッシュ削除と再読込の競合も防ぐ。
  - PR: [#79](https://github.com/Kay-pht/foodfolio/pull/79)
  - main反映: `a9c0291ebe848c4d6c9ff33934a9f902ba9dd560`
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0 (8)`

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
