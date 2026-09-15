# Foodfolio 未反映機能

PR作成前に、利用者の操作や実行環境の挙動が変わる項目をこのファイルへ追加する。
項目ごとに「必要な反映先」を決め、すべての反映を証跡付きで確認できたら、項目全体を `tasks/released.md` へ移す。
実機確認は反映済み判定に含めず、必要な検証は `tasks/todo.md` などで別に管理する。

## 未反映

- [ ] `REL-20260915-01` AI共有レシピの生成サムネイル
  - 内容: 新規のChatGPT / Gemini共有レシピで、材料と手順が取得でき、元画像がない場合にOpenAI GPT-Image-2.5 Flareで代表サムネイルを生成して表示する。画像生成失敗時もレシピ保存は継続する
  - PR: #103
  - main反映: 未反映
  - 必要な反映先:
    - [ ] GCP dev infrastructure — 生成画像bucket / IAM / OpenAI Secret / Cloud Run環境変数
    - [ ] Cloud Run dev — API / Worker revision: 未定
    - [ ] Firebase Hosting — 更新済みプライバシーポリシー
  - 備考: 既存保存済みAI共有レシピへのバックフィルは行わない。実画像生成・表示はローカルまたはdevで別途実地確認する

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
