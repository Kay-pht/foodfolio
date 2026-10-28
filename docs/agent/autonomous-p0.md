# P0 自律開発ガードレール

Foodfolio の自律開発では、AIの判断そのものを信頼境界にせず、仕様・検証・レビュー証跡・最終マージ条件を分離する。

## フロー

1. 人間とAIで仕様を確定し、`specs/tasks/*.yaml` を作成する。
2. `npm run check:specs` が成功してからImplementerが実装する。
3. バグ修正では修正前に回帰テストが失敗することを確認し、修正後に成功させる。
4. Implementerが必要なローカル検証とCIを完了させ、実際の成功コマンド（配下の検証を含む）・対象SHA・終了コード・ログ参照を引き継ぐ。Reviewerは成功結果を信頼し、同じ検証を再実行しない。追加検証は未検証の具体的な論点がある場合だけ理由と結果を記録する。
5. Implementerが初回だけ自主的に新規の別チャットを作成し、fresh contextの独立Reviewerへ依頼して結果を待つ。同じ会話内のサブエージェントや実装会話のforkで代用しない。承認済みの [アラート修正ハーネス](alert-repair.md) の案件は既存の独立セッション制御を維持する。
6. Reviewerは問題があれば元の実装チャットへ根拠と分類を返し、元チャットが修正する。既存仕様に基づくバグは自律的に修正し、仕様変更や期待動作が曖昧な指摘は必ず変更前にユーザーへ確認する。修正後は必要な検証を行い、実装チャットと同じReviewerチャットの2つで修正内容・結果を往復する。問題がなければReviewerが `npm run review:lgtm` で最新HEADにLGTMを記録し、対応する外部Task-Listを同期する。
7. AIの作業はここで終了する。
8. 人間が最終確認として `npm run pr:merge` を実行する。

## 信頼境界

- `main` への直接pushは禁止する。tracked pre-push hookで通常操作を拒否し、main push時のCIでも違反を検知する。ただしGitHub Free private repositoryではサーバー側branch protection相当の完全な強制ではない。
- AIは `npm run pr:merge` を実行しない。
- LGTMはPR番号と完全なHEAD SHAに紐付ける。新しいコミットが追加された時点で無効になる。
- 通常レビューは `npm run review:flow` のPR別台帳でチャットID・SHA・分類・返却を記録し、通常LGTMと人間のmerge時に独立レビュー情報を検証する。初回後の再レビューは最大3回で、実装者の自己承認や履歴リセットを認めない。
- レビュー証跡は `.git/foodfolio/review-proof.json` に保存し、tracked Git treeへ含めない。
- 人間のmergeコマンドは `--match-head-commit` を使用し、review後のHEAD変更をGitHub側でも拒否させる。

詳細な役割と停止条件は [review.md](review.md)、実装ルールは [development.md](development.md)、検証ルールは [testing.md](testing.md) を参照する。
