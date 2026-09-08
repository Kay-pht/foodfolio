# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260908-01` 月次AI解析受付上限
  - 内容: JSTの月単位で、全体500件・1利用者100件を上限として新規解析を受付時に制限する。実行中枠は解析の終端状態で解放し、iOSでは上限到達理由を表示する。
  - PR: [#72](https://github.com/Kay-pht/foodfolio/pull/72)
  - main反映: `6af7a3916abe734851dba7467e55b1a5ef9ac737`
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0 (7)`
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-08`、version: `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d`、API `foodfolio-dev-api-00025-dm7` / Worker `foodfolio-dev-worker-00028-f4r`、traffic 100%

- [ ] `REL-20260908-02` レシピ追加をクリップボード優先の導線に変更する
  - 内容: レシピ追加画面でクリップボード内のWeb URLを候補として案内し、貼り付けて作成できるようにする。候補がない場合や権限を許可しない場合も、従来どおり手入力できる。
  - PR: [#74](https://github.com/Kay-pht/foodfolio/pull/74)
  - main反映: `a3d159e7ecd2cacecb997a5df7a5280e158213fb`
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0 (7)`

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
