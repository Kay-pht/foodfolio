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
    - [ ] TestFlight内部テスト — 対象version/build: 未定
  - 備考: build `1.0 (5)` の作成後にmainへ入ったiOS変更のため、現在配布中のbuild 5には含まれない

- [ ] `REL-20260906-02` 起動時のAI同意確認を非ブロッキング化する
  - 内容: 同期済みの端末内AI同意を通常起動時に即時採用し、起動ごとの同意GETと「AI解析の利用設定を確認しています…」表示を廃止する。AI同意のサーバー保存に一時失敗してもログアウトやローカルレシピ削除は行わず、同意画面から再試行できるようにする。起動時はFoodfolioのブランドマークを表示する
  - PR: [#58](https://github.com/Kay-pht/foodfolio/pull/58)
  - main反映: 未反映
  - 必要な反映先:
    - [ ] TestFlight内部テスト — 対象version/build: 未定

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
