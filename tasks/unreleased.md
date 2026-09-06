# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260906-01` 共有シートでURL確認後に作成し、二重送信を防止する
  - 内容: Foodfolioを共有先に選んだだけでは保存せず、URL表示後の「作成」で送信する。成功表示は「閉じる」まで維持し、送信中の連打も拒否する
  - PR: [#53](https://github.com/Kay-pht/foodfolio/pull/53)
  - main反映: `b3377032ce9cc59fc0f0a602d209e09802fb58e9`
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0 (6)`
  - 備考: build `1.0 (5)` の作成後にmainへ入ったiOS変更のため、現在配布中のbuild 5には含まれない

- [ ] `REL-20260906-03` AI解析専用の同意機能を廃止する
  - 内容: Z.ai / Geminiの解析requestへFoodfolio利用者のUser ID、Firebase UID、メール、認証Token、端末Token等を送らない現行境界に合わせ、認証前同意画面、同意store、同意API、Recipe作成gate、Share Extension判定、DBの同意日時、撤回UIを削除する。AI Providerの利用と送信対象はプライバシーポリシーで開示する
  - PR: [#60](https://github.com/Kay-pht/foodfolio/pull/60)、[#61](https://github.com/Kay-pht/foodfolio/pull/61)
  - main反映: `254c08791a2f11692b3d41bd2a5a6f2d3756b785`
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: `1.0 (6)`
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-06`、version: `254c08791a2f11692b3d41bd2a5a6f2d3756b785`、API `foodfolio-dev-api-00017-ntq` / Worker `foodfolio-dev-worker-00020-qgs`、traffic 100%
    - [x] Firebase Hosting — 反映日: `2026-09-06`、URL: `https://foodfolio-af28aa.web.app/privacy`
  - 備考: PR #60はGitHub上でmerge済みだがmain refにmerge commitが含まれないため、修正版をPR #61で再提示する。旧iOS buildは互換対象外。稼働中の旧Backendを壊さないため、このリリースではDB columnを残したまま同意依存のないBackendを先に反映し、その後に新iOSだけを利用する。`aiConsentedAt`のdropは旧Backend revisionへrollbackしないことを確認した後の独立したmigrationで行う。更新したプライバシーポリシーはFirebase Hostingへの反映も必要

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
