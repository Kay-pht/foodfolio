# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260907-01` Instagram動画フォールバック
  - 内容: 公開InstagramのReelと単一動画投稿で、metadata解析だけでは材料・手順が揃わない場合に限り、動画を一時取得してAI動画解析へフォールバックする。画像・カルーセル・mixed carouselはこのPRでは対象外とする。
  - PR: https://github.com/Kay-pht/foodfolio/pull/68
  - main反映: 未反映
  - 必要な反映先:
    - [ ] Cloud Run（dev） — 対象Git SHA/revision: 未定
  - 備考: 一時メディアは既存のprivate GCS bucketを共用し、解析後または失敗時に削除する。bucket lifecycleの1日削除も既存の安全網として維持する。

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
