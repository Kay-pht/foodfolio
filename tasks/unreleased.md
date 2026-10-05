# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20261005-01` Foodfolio 1.0.3をAppleへアップデート申請する
  - 内容: 公開中の1.0.2 (15)からパッチ番号を上げ、mainのメモ追加・表示改善・200字上限と作り方編集・ドラッグ並べ替えを1.0.3 (16)へ含める
  - PR: 準備 [#139](https://github.com/Kay-pht/foodfolio/pull/139)、申請記録 [#140](https://github.com/Kay-pht/foodfolio/pull/140)。対象機能は [#133](https://github.com/Kay-pht/foodfolio/pull/133) / [#134](https://github.com/Kay-pht/foodfolio/pull/134) / [#135](https://github.com/Kay-pht/foodfolio/pull/135) / [#137](https://github.com/Kay-pht/foodfolio/pull/137) / [#138](https://github.com/Kay-pht/foodfolio/pull/138)
  - main反映: `1b0e95d01aca9da29796eb414b070a953ad302ae`（準備PR #139）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-05`、version: `1.0.3 (16)`、Build ID: `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.3 (16)`、Appleへの審査申請後も未公開のまま維持し、ユーザーが手動公開する
    - [x] Cloud Run（dev API / Worker） — 確認日: `2026-10-05`、source: `493ed7ea9d12e378510d1c2c0a2b2583a61830df`、API `foodfolio-dev-api-00052-2tz` / Worker `foodfolio-dev-worker-00056-jnj`、Ready、traffic 100%。Deploy dev Run `37217030911`でmigration未適用なしを確認。配布前の再取得でも同じrevisionとtrafficを確認。DBで9 migrations適用済み、メモmigration適用済み、未完了・rollbackなし
  - 備考: 2026-10-05 11:35（JST）にApp Review提出済み。Submission ID `f80cf6e3-ad26-4410-aa96-62286a4f4b21`、version / submissionともに`WAITING_FOR_REVIEW`、`MANUAL`。新しい審査用アカウントのログイン・APIアクセス確認とApple登録を完了。本タスクのゴールは人間による準備PRマージ後のApp Review提出。一般公開は対象外。メモ追加PR #133には`20260930152000_add_recipe_memo`が含まれる。ローカル検証、CI、merge、API / DB反映、Apple upload、processing、内部配布、審査申請を別の証跡として記録する

- [ ] `REL-20261004-02` メモ画面と保存ボタンを改善し、上限を200字にする
  - 内容: メモシートを半分程度の高さで開き、必要時に広げられるようにする。入力欄を数行分に縮め、保存中のボタン形状を維持する。iOS・APIの保存上限を200字に揃える
  - PR: [#138](https://github.com/Kay-pht/foodfolio/pull/138)
  - main反映: `493ed7ea`（PR #138）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-05`、version: `1.0.3 (16)`、Build ID: `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.3 (16)`
    - [x] Cloud Run（dev API） — 確認日: `2026-10-05`、source: `493ed7ea9d12e378510d1c2c0a2b2583a61830df`、revision: `foodfolio-dev-api-00052-2tz`、Ready、traffic 100%
  - 備考: DB migrationなし。既存データ対応は不要とユーザー確認済み。APIとiOSの文字数判定を前後空白除去後のUnicode scalar数へ揃える。前後空白の除去対象はサーバーと同じ集合を使い、ゼロ幅スペースなど除去対象外の文字も200字制限に含める

- [ ] `REL-20261004-01` 手順のドラッグ並べ替えとメモ全文の表示条件を改善する
  - 内容: レシピ編集の各手順に右端の三本線つまみを常時表示し、ドラッグで順序を入れ替える。削除ボタンを残し、上下ボタンを廃止する。メモの「全文を見る」は表示幅・文字サイズに対して本文が実際に3行で省略される場合だけ表示する
  - PR: [#137](https://github.com/Kay-pht/foodfolio/pull/137)
  - main反映: `11c1aee7`（PR #137）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-05`、version: `1.0.3 (16)`、Build ID: `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.3 (16)`
  - 備考: iOSのみ。API・DB・同期契約は変更しない。全文表示済みのメモは既存のメニューから編集できる

- [ ] `REL-20261003-02` レシピ詳細でメモ本文を見やすく表示する
  - 内容: 保存済みメモがある場合、レシピ詳細のタグと材料の間に「自分のメモ」カードを表示し、本文冒頭を最大3行までその場で読めるようにする。「全文を見る」から既存のメモシートを開けるようにし、従来の小さな「メモ」ショートカット表示は廃止する
  - PR: [#135](https://github.com/Kay-pht/foodfolio/pull/135)
  - main反映: `4455b8f8`（PR #135）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-05`、version: `1.0.3 (16)`、Build ID: `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.3 (16)`
  - 備考: メモ未登録のレシピではカードを表示しない。メモ追加・編集・削除、同期、検索対象外など既存のメモ仕様は変更しない

- [ ] `REL-20261003-01` レシピ編集で作り方を編集可能にする
  - 内容: 手順番号付き複数行入力欄で本文修正・追加・削除・上下移動を可能にする。空欄の手順を保存時に消去し、0件でも保存できる。更新API・ローカル保存・同期で手順と順序を保持する
  - PR: [#134](https://github.com/Kay-pht/foodfolio/pull/134)
  - main反映: `1e70177a`（PR #134）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-10-05`、version: `1.0.3 (16)`、Build ID: `04094ec3-5d57-4f0d-88a8-c447acc6d6d5`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.3 (16)`
    - [x] Cloud Run（dev API） — 確認日: `2026-10-05`、source: `493ed7ea9d12e378510d1c2c0a2b2583a61830df`、revision: `foodfolio-dev-api-00052-2tz`、Ready、traffic 100%
  - 備考: DB schema変更なし。APIを先に反映してからiOSを配布する。編集transactionでは親行を先にロックし、材料・手順の置換後に更新時刻を設定することで、保存中の差分同期による取りこぼしを抑止する

- [ ] `REL-20260924-01` Foodfolio 1.0.2で日本語表示情報とApp Store掲載内容を更新する
  - 内容: iOS本体とShare Extensionが日本語対応アプリであることをAppleへ正しく申告し、インストール後のアプリ名は`Foodfolio`のまま維持する。App Store上の表示名を「レシピ保存/管理アプリ - Foodfolio」へ変更し、利用許可を確認済みの新しい日本語マーケティング画像6枚へ差し替える。あわせて、PR #121/#122でmainへ追加した5つのCloud Monitoring alert policyを既存Slack通知先へ反映する
  - PR: 日本語申告 [#124](https://github.com/Kay-pht/foodfolio/pull/124)、App Store画像 [#125](https://github.com/Kay-pht/foodfolio/pull/125)、Runtime Monitoring [#121](https://github.com/Kay-pht/foodfolio/pull/121) / [#122](https://github.com/Kay-pht/foodfolio/pull/122)、配布準備 [#126](https://github.com/Kay-pht/foodfolio/pull/126)、配布記録 [#128](https://github.com/Kay-pht/foodfolio/pull/128)
  - main反映: `f0c1501e33cca924adabc1f409cce8a8c6bd791a`（PR #126）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-24`、version: `1.0.2 (15)`、Build ID: `5407229d-ef1b-47cf-8c98-60f8f1c8848e`、group: `Foodfolio Internal`
    - [ ] TestFlight外部テスト — 対象version/build: `1.0.2 (15)`、既存`Foodfolio External`へ割り当て済み、Beta App Review `WAITING_FOR_REVIEW`
    - [ ] App Store本番 — 対象version/build: `1.0.2 (15)`、version ID: `466babf4-c636-4fe0-8511-238b7e1d2c77`、Submission ID: `db504a03-0150-4de4-9ecd-66b117fae1a6`、App Review `WAITING_FOR_REVIEW`、Apple承認後に手動公開
    - [x] GCP runtime monitoring — 反映日: `2026-09-24`、project: `foodfolio-af28aa`、既存5 alert policiesを`0 add / 5 update / 0 destroy`で更新し、既存Slack notification channel `#foodfolio-alerts`への紐付け、日本語subject、Recipe Analysisの8つの非機密label extractorをAPIで再取得
  - 備考: Release Archive、Apple validation、upload、processing `VALID`、内部・外部group割り当て、What to Test保存、App Store掲載名・更新内容・審査情報、`APP_IPHONE_67`の新画像6枚、無料・日本限定・Food & Drink・年齢区分を再取得した。`CFBundleDisplayName`と`CFBundleName`は本体・Share Extensionとも`Foodfolio`を維持し、英語UI翻訳と言語選択機能は対象外。公開直前にユーザーの最終確認を行う。監視反映では意図的な障害・OOM・最終失敗を発生させていないため、実Slack通知の発火確認は実施していない

- [ ] `REL-20260918-01` Share Extensionの送信表示を一般向けにする
  - 内容: Post後は「確認中」とスピナーを表示し、成功時は「✓ 送信」と表示する。利用者向けUIから「Backend」という内部用語を削除する
  - PR: #110
  - main反映: `c79ea33760057063464055c504a1560453667904`（PR #110）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-22`、version: `1.0.1 (14)`、Build ID: `7db14f24-ffd5-4c9f-9bdf-966b3937e711`、group: `Foodfolio Internal`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
  - 備考: 2026-09-18にiOS更新後の実機でShare Extension自体の正常動作は確認済み。本項目は機能修正ではなく表示改善

- [ ] `REL-20260922-01` Foodfolio 1.0.1でmainの変更を配布する
  - 内容: build 13以後のmainに含まれるレシピ同期の欠損修復、解析結果`not_recipe`対応、Jev経路の設定・判定、およびShare Extensionの表示改善を1.0.1 (14)へ含める。Jevの実使用はデプロイ済み設定で確認する
  - PR: #119
  - main反映: `c4f85fbc0d076645c2f43655e1291647583c5c40`（PR #119）
  - 必要な反映先:
    - [x] TestFlight内部テスト — 反映日: `2026-09-22`、version: `1.0.1 (14)`、Build ID: `7db14f24-ffd5-4c9f-9bdf-966b3937e711`、group: `Foodfolio Internal`
    - [ ] TestFlight外部テスト — 対象version/build: `1.0.1 (14)`、`Foodfolio External`へ割り当て済み、Beta App Review `WAITING_FOR_REVIEW`
    - [ ] App Store本番 — 対象version/build: `1.0.1 (14)`
    - [x] Cloud Run（dev API / Worker） — 確認日: `2026-09-22`、version: `fe56f2cf30e322a55af2e093495e510d4bff009c`、API `foodfolio-dev-api-00041-cbd` / Worker `foodfolio-dev-worker-00045-gvp`、Ready、traffic 100%
  - 備考: App Store Connect version 1.0.1へbuild 14を選択し、App Reviewへ提出済み。Submission ID `fc385487-84a2-4fa0-b595-90b451cbdd5d`、`WAITING_FOR_REVIEW`。Apple承認後の手動公開は未実施

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
