# Foodfolio 反映済み機能

`tasks/unreleased.md` で指定した必要な反映先がすべて反映済みになった項目を、日付とversion情報を保ったまま記録する。
日付は日本時間（JST）の `YYYY-MM-DD`、iOSは `version (build)`、Cloud RunはGit SHAとservice revisionを記載する。

## 2026-09-06

- [x] `REL-20260906-01` 共有シートでURL確認後に作成し、二重送信を防止する
  - 内容: Foodfolioを共有先に選んだだけでは保存せず、URL表示後の「作成」で送信する。成功表示は「閉じる」まで維持し、送信中の連打も拒否する
  - PR: [#53](https://github.com/Kay-pht/foodfolio/pull/53)
  - main反映: `b3377032ce9cc59fc0f0a602d209e09802fb58e9`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-06`、version: `1.0 (6)`、Build ID: `0edb524b-20d2-4589-9fa5-320e26d62165`、group: `Foodfolio Internal`
  - 配布build source: `197253683d13ec8e2ce017f62a63cfbcb3c19999`

- [x] `REL-20260906-03` AI解析専用の同意機能を廃止する
  - 内容: Z.ai / Geminiの解析requestへFoodfolio利用者のUser ID、Firebase UID、メール、認証Token、端末Token等を送らない現行境界に合わせ、認証前同意画面、同意store、同意API、Recipe作成gate、Share Extension判定、DBの同意日時、撤回UIを削除する。AI Providerの利用と送信対象はプライバシーポリシーで開示する
  - PR: [#60](https://github.com/Kay-pht/foodfolio/pull/60)、[#61](https://github.com/Kay-pht/foodfolio/pull/61)、[#62](https://github.com/Kay-pht/foodfolio/pull/62)
  - main反映: `254c08791a2f11692b3d41bd2a5a6f2d3756b785`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-06`、version: `1.0 (6)`、Build ID: `0edb524b-20d2-4589-9fa5-320e26d62165`、group: `Foodfolio Internal`
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-06`、version: `254c08791a2f11692b3d41bd2a5a6f2d3756b785`、API `foodfolio-dev-api-00017-ntq` / Worker `foodfolio-dev-worker-00020-qgs`、traffic 100%
    - [x] Firebase Hosting — 反映日: `2026-09-06`、URL: `https://foodfolio-af28aa.web.app/privacy`
  - 配布build source: `197253683d13ec8e2ce017f62a63cfbcb3c19999`
  - 備考: `aiConsentedAt` columnは旧Backend revisionへのrollback可能性がなくなった後、独立したmigrationで削除する

- [x] `REL-20260906-02` YouTube解析で元タイトルと未取得分量を保持する
  - 内容: YouTube Data APIで取得したタイトルを保存し、取得できなかった材料の分量を `null` のまま保持する。元データにある「適量」は維持する
  - PR: [#55](https://github.com/Kay-pht/foodfolio/pull/55)
  - main反映: `352fd442f6ef4ee86b44805352495315406b2efb`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-06`、version: `352fd442f6ef4ee86b44805352495315406b2efb`、初回反映revision: API `foodfolio-dev-api-00015-7sb` / Worker `foodfolio-dev-worker-00018-6w6`
  - 現在の稼働確認: `2026-09-06`、main `1ce0bbb5083ee29520e2daa0ebdd8d560e340e6c`、API `foodfolio-dev-api-00016-xzl` / Worker `foodfolio-dev-worker-00019-nxp`、traffic 100%

## 2026-09-05

- [x] `REL-20260905-01` YouTube説明不足時のGemini動画解析を現在利用中のdev環境で有効化する
  - 内容: WorkerへGemini API keyをSecret Managerから注入し、`YOUTUBE_GEMINI_FALLBACK_ENABLED=true` で動画解析fallbackを有効化する
  - PR: [#54](https://github.com/Kay-pht/foodfolio/pull/54)
  - main反映: `f00aec3d38506f6648a81928699915ef59c41928`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-05`、version: `f00aec3d38506f6648a81928699915ef59c41928`、初回反映revision: Worker `foodfolio-dev-worker-00017-lkj`
  - 現在の稼働確認: `2026-09-06`、Worker `foodfolio-dev-worker-00019-nxp`、traffic 100%、`YOUTUBE_GEMINI_FALLBACK_ENABLED=true`

- [x] `REL-20260905-02` Foodfolio `1.0 (5)` をTestFlight内部テストへ配布する
  - 内容:
    - Apple / Google / メール認証
    - URL保存、AI解析、解析後の自動更新、レシピ一覧・詳細・編集
    - 検索、タグの追加・編集、同期
    - 解析成功・失敗のPush通知設定
    - 設定、ログアウト、アカウント削除
    - 認証前のAI解析同意、サーバー同期、設定からの同意撤回
    - iOS共有シートからのレシピURL保存
    - YouTube説明不足時のGemini動画解析対応
  - 関連PR: [#46](https://github.com/Kay-pht/foodfolio/pull/46)、[#45](https://github.com/Kay-pht/foodfolio/pull/45)、[#48](https://github.com/Kay-pht/foodfolio/pull/48)、[#51](https://github.com/Kay-pht/foodfolio/pull/51)、[#52](https://github.com/Kay-pht/foodfolio/pull/52)
  - source基準: `f89c4e5e3e20a8d7fbbc149ed5fa719a08daca53`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-05`、version: `1.0 (5)`、Build ID: `aaf7a5b6-645c-4cc1-aa39-c9c5f9cffef5`、group: `Foodfolio Internal`
  - App Store Connect再確認: `2026-09-06`、processing `VALID`、build有効、内部グループ割り当て済み
  - 備考: App Store本番公開はこの項目の必要な反映先に含めておらず、未実施
