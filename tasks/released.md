# Foodfolio 反映済み機能

`tasks/unreleased.md` で指定した必要な反映先がすべて反映済みになった項目を、日付とversion情報を保ったまま記録する。
日付は日本時間（JST）の `YYYY-MM-DD`、iOSは `version (build)`、Cloud RunはGit SHAとservice revisionを記載する。

## 2026-09-15

- [x] `REL-20260915-01` AI共有レシピの取り込みと生成サムネイル
  - 内容: 公開ChatGPT / Gemini共有会話を1件のレシピとして取り込み、後から加えた変更を反映する。新規レシピで材料と手順が取得でき、元画像がない場合にOpenAI GPT-Image-2.5 Flareで代表サムネイルを生成して表示する。画像生成失敗時もレシピ保存は継続する。
  - PR: [#101](https://github.com/Kay-pht/foodfolio/pull/101)、[#103](https://github.com/Kay-pht/foodfolio/pull/103)、配布準備 [#105](https://github.com/Kay-pht/foodfolio/pull/105)
  - main反映: `f5880904c6af712eb8cd1276f625f4598f2bee19`
  - 必要な反映先:
    - [x] GCP dev infrastructure — 反映日: `2026-09-15`、生成画像bucket `foodfolio-af28aa-dev-generated-recipe-images`、API / Worker objectAdmin、既知objectのpublic read、OpenAI Secret version 1、Cloud Run環境変数をTerraformで反映。適用後planは差分なし。
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-15`、version: `f5880904c6af712eb8cd1276f625f4598f2bee19`、API `foodfolio-dev-api-00036-6wm` / Worker `foodfolio-dev-worker-00039-m4b`、Ready、traffic 100%、API health成功。
    - [x] Firebase Hosting — 反映日: `2026-09-15`、更新済みプライバシーポリシーを `https://foodfolio-af28aa.web.app/privacy` へ反映し、公開内容のSHA-256がmainの配布物と一致。
    - [x] TestFlight内部テスト — 反映日: `2026-09-15`、version: `1.0 (13)`、Build ID: `8c5ebc62-634c-47f2-b1d8-08bc1c608c1e`、group: `Foodfolio Internal`
    - [x] TestFlight外部テスト — 反映日: `2026-09-15`、version: `1.0 (13)`、Build ID: `8c5ebc62-634c-47f2-b1d8-08bc1c608c1e`、group: `Foodfolio External`、Beta App Review `APPROVED`
  - 配布build source: `b920e03366bad11ef3e1972ff9fa59f87b2283e3`
  - 備考: dev実地検証でChatGPT共有レシピからWebP画像を生成し、Recipeの画像URLからpublic readできること、bucket一覧は403となること、アカウント削除後に生成objectとFirebaseテストアカウントが削除されることを確認済み。既存保存済みAI共有レシピへのバックフィルは行わない。外部グループの公開リンク有効状態と既存テスター2件は維持。実機でのbuild 13更新と動作確認は `tasks/todo.md` で別管理する。

## 2026-09-14

- [x] `REL-20260914-01` 「作りたい」レシピと同期・操作競合対策を提供する
  - 内容: レシピ詳細から「作りたい」を追加・解除し、対象レシピをホーム上部へ新しい順で表示する。BackendとSwiftDataで状態を同期し、旧storeを移行する。古い同期・mutation応答が新しい編集・タグ・削除・「作りたい」操作を上書きしたり、削除済みレシピを復活させたりしないようにする。
  - PR: [#97](https://github.com/Kay-pht/foodfolio/pull/97)、配布準備 [#99](https://github.com/Kay-pht/foodfolio/pull/99)
  - main反映: 機能 `340a7c4cc772b790477dcb006a95f502579885f5`、build番号 `8833bc2ac6fb9ec0f1af7a51ba3a0993397994f5`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-14`、version: `340a7c4cc772b790477dcb006a95f502579885f5`、image `sha256:0c214db23861c991b35c08f9e870da3a4eae0da5fe97c690f7592ae16c864513`、API `foodfolio-dev-api-00033-jvb` / Worker `foodfolio-dev-worker-00036-hvr`、Ready、traffic 100%、API health成功
    - [x] TestFlight内部テスト — 反映日: `2026-09-14`、version: `1.0 (12)`、Build ID: `366c4a95-5fc5-449b-962f-a124b577bb47`、group: `Foodfolio Internal`
    - [x] TestFlight外部テスト — 反映日: `2026-09-14`、version: `1.0 (12)`、Build ID: `366c4a95-5fc5-449b-962f-a124b577bb47`、group: `Foodfolio External`、Beta App Review `APPROVED`
  - 配布build source: `8833bc2ac6fb9ec0f1af7a51ba3a0993397994f5`
  - 備考: 外部グループの公開リンク有効状態と既存テスター2件は維持。実機でのbuild 12更新と動作確認は `tasks/todo.md` で別管理する。

## 2026-09-12

- [x] `REL-20260912-01` iOSの共有タグ永続化と旧store移行を修正する
  - 内容: 複数レシピが同じタグを共有できるSwiftData関係へ修正し、既存storeのタグ関係を一度だけfull syncで復旧する。重複upsert、同期、検索、legacy-store migrationを検証する。
  - PR: [#94](https://github.com/Kay-pht/foodfolio/pull/94)
  - main反映: `ae743c872f3417924f6f97374657b077cfbe4ff3`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-12`、version: `1.0 (11)`、Build ID: `00863d38-fc2a-4ae8-a331-f64959c54fca`、group: `Foodfolio Internal`
    - [x] TestFlight外部テスト — 反映日: `2026-09-12`、version: `1.0 (11)`、Build ID: `00863d38-fc2a-4ae8-a331-f64959c54fca`、group: `Foodfolio External`、Beta App Review `APPROVED`
  - 配布build source: `a49703f26b6f2ebb5c6a297596d613dbc11f1122`
  - 備考: 外部グループの公開リンク有効状態と既存テスター2件はユーザー指示により維持。実機でのbuild 11更新と動作確認は `tasks/todo.md` で別管理する。

## 2026-09-11

- [x] `REL-20260910-01` Share Extensionの標準Postと送信結果表示を修正する
  - 内容: 共有URLの非同期取得後に `SLComposeServiceViewController` のcontent validationを更新し、標準Postを有効化する。Post / Cancelはシステム標準へ統一する。Backendが追加を受理した場合は成功ダイアログを表示し、利用者が確認してから閉じる。重複・受付上限・認証・不正URL・通信・その他の失敗理由を区別し、一時的な通信・サーバー失敗だけ再試行を表示する。Share ExtensionはFoodfolio本体と同じLight外観に統一する。
  - PR: [#88](https://github.com/Kay-pht/foodfolio/pull/88)
  - main反映: `937de361ebed5c1ec21c1b4c208e17bf3696ae44`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-11`、version: `1.0 (10)`、Build ID: `32d303fd-1280-4f75-ad38-16d061d79654`、group: `Foodfolio Internal`
  - 配布build source: `80c6bc5b361f018ee24aea666403a5f45b5be074`
  - 備考: 実機で発生しているShare Extensionの全面blank/black画面の原因調査と修正は別タスクとして残す。内部テスターによる実機確認は未実施。

- [x] `REL-20260911-01` TikTok写真投稿を画像優先で解析する
  - 内容: TikTokの写真投稿URLを正式な対応URLとして扱い、Embed Playerの画像一覧とキャプションを取得して、投稿順を維持した画像優先のAI解析へ渡す。取得先URLは既存のSSRF防御を通し、解析後の一時オブジェクトを削除する。
  - PR: [#89](https://github.com/Kay-pht/foodfolio/pull/89)
  - main反映: `b160924cc5c4f4477112b3836dadbd0bec959c08`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-11`、version: `b160924cc5c4f4477112b3836dadbd0bec959c08`、API `foodfolio-dev-api-00031-mxm` / Worker `foodfolio-dev-worker-00034-v8p`、traffic 100%
  - 備考: API / Workerの両方で `TIKTOK_MEDIA_ANALYSIS_ENABLED=true`、旧 `TIKTOK_VIDEO_FALLBACK_ENABLED` 未設定、API `/health` 成功を確認済み。

## 2026-09-09

- [x] `REL-20260909-03` 画像再取得で初回解析と同じ代表画像解決を使用する
  - 内容: 端末内の保存画像と保存済み画像URLの両方から画像を復旧できない場合に、Backendが初回解析と同じ媒体別ロジックで代表画像URLを再解決する。LinkPresentationのプレビュー画像は使用せず、再取得画像にも通常の中央拡大・トリミングを適用する。
  - PR: [#84](https://github.com/Kay-pht/foodfolio/pull/84)
  - main反映: `26732f4ec5554f2891e1916c9afa80150709d723`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-09`、version: `1.0 (9)`、Build ID: `1d7c06fc-fc52-43ea-b1c8-7ad9567bd8ef`、group: `Foodfolio Internal`
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-09`、version: `87e9ffb6621ef758b5f85d26b614205f7a8917a4`、API `foodfolio-dev-api-00029-x8x` / Worker `foodfolio-dev-worker-00031-c5x`、traffic 100%
  - 配布build source: `f40b20736a64575b66dfcb5069ef8d894d231be6`
  - 備考: Cloud Run APIが既存の `foodfolio-dev-youtube-api-key` Secretを参照することを確認済み。

- [x] `REL-20260909-02` 欠損したレシピ画像を元URLから復旧する
  - 内容: 保存済みの画像URLから表示できない場合に、元レシピURLの代表画像を取得して端末内へキャッシュする。端末内キャッシュ、保存済み画像URL、元URL、既定プレースホルダーの順で表示を試み、同期時のキャッシュ削除と再読込の競合も防ぐ。
  - PR: [#79](https://github.com/Kay-pht/foodfolio/pull/79)
  - main反映: `a9c0291ebe848c4d6c9ff33934a9f902ba9dd560`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-09`、version: `1.0 (8)`、Build ID: `4d337a07-fd2d-46c4-80c6-73bc2bf8d61c`、group: `Foodfolio Internal`
  - 配布build source: `052fea7fe05d0128e1901dc8716363fc283d2b6c`

- [x] `REL-20260909-01` AI解析で根拠に基づく料理名を原則必須にする
  - 内容: AIへ提供された投稿文、ページ本文、画像、動画、音声、画面内テキスト、材料、調理手順などを根拠に、簡潔な料理名を必ず生成するよう解析指示を強化する。AIが有効な料理名を返さない場合の「タイトル未取得のレシピ」は安全策として維持する
  - PR: [#80](https://github.com/Kay-pht/foodfolio/pull/80)
  - main反映: `bf933657bcdb87bccaae4c36df4331600a74430a`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-09`、version: `bf933657bcdb87bccaae4c36df4331600a74430a`、API `foodfolio-dev-api-00026-tq9` / Worker `foodfolio-dev-worker-00029-xrz`、traffic 100%

- [x] `REL-20260908-01` 月次AI解析受付上限
  - 内容: JSTの月単位で、全体500件・1利用者100件を上限として新規解析を受付時に制限する。実行中枠は解析の終端状態で解放し、iOSでは上限到達理由を表示する。
  - PR: [#72](https://github.com/Kay-pht/foodfolio/pull/72)
  - main反映: `6af7a3916abe734851dba7467e55b1a5ef9ac737`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-09`、version: `1.0 (7)`、Build ID: `063c15a7-b6fb-4034-8860-203185b377f7`、group: `Foodfolio Internal`
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-08`、version: `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d`、API `foodfolio-dev-api-00025-dm7` / Worker `foodfolio-dev-worker-00028-f4r`、traffic 100%
  - 配布build source: `0085d1b9a525dc35b69346ac8d85153bdf9b2a04`

- [x] `REL-20260908-02` レシピ追加をクリップボード優先の導線に変更する
  - 内容: レシピ追加画面でクリップボード内のWeb URLを候補として案内し、貼り付けて作成できるようにする。候補がない場合や権限を許可しない場合も、従来どおり手入力できる。
  - PR: [#74](https://github.com/Kay-pht/foodfolio/pull/74)
  - main反映: `a3d159e7ecd2cacecb997a5df7a5280e158213fb`
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-09`、version: `1.0 (7)`、Build ID: `063c15a7-b6fb-4034-8860-203185b377f7`、group: `Foodfolio Internal`
  - 配布build source: `0085d1b9a525dc35b69346ac8d85153bdf9b2a04`

## 2026-09-08

- [x] `REL-20260908-03` IPv6リテラルによるSSRF制限迂回を防止する
  - 内容: URL検証で角括弧付きIPv6リテラルを正規化し、loopback、private、link-local等の禁止アドレスへのBackend通信を拒否する。
  - PR: [#75](https://github.com/Kay-pht/foodfolio/pull/75)
  - main反映: `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-08`、version: `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d`、API `foodfolio-dev-api-00025-dm7` / Worker `foodfolio-dev-worker-00028-f4r`、traffic 100%

- [x] `REL-20260907-01` Instagramメディアフォールバック
  - 内容: 公開InstagramのReel、単一動画、単一画像、画像carousel、画像と動画のmixed carousel、pure video carouselで、metadata解析だけでは材料・手順が揃わない場合に限り、投稿順を維持した全メディアを一時取得してAI解析へフォールバックする。一部entryだけを解析成功として扱わない。
  - PR: [#68](https://github.com/Kay-pht/foodfolio/pull/68)、[#70](https://github.com/Kay-pht/foodfolio/pull/70)
  - main反映: `e0395db540a95364493943ecbf8f1e7eb7c92c0c`
  - 必要な反映先:
    - [x] Cloud Run（現在利用中のdev） — 反映日: `2026-09-08`、version: `a439f7cb3d04e5868a11923f6f4d7cbac1b59b5d`、API `foodfolio-dev-api-00025-dm7` / Worker `foodfolio-dev-worker-00028-f4r`、traffic 100%
  - 備考: 一時メディアは既存のprivate GCS bucketを共用する。carouselは各entryをdownload、GCS publish、local削除の順で逐次処理し、解析後または失敗時にGCS objectを削除する。bucket lifecycleの1日削除も既存の安全網として維持する。

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
