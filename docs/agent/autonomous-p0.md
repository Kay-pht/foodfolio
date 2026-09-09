# P0 自律開発ガードレール

Foodfolio の自律開発では、AIの判断そのものを信頼境界にせず、仕様・検証・レビュー証跡・最終マージ条件を分離する。

## フロー

1. 人間とAIで仕様を確定し、`specs/tasks/*.yaml` を作成する。
2. `npm run check:specs` が成功してからImplementerが実装する。
3. バグ修正では修正前に回帰テストが失敗することを確認し、修正後に成功させる。
4. Implementerが必要なローカル検証とCIを完了させる。
5. 人間が別セッションのReviewerにレビューを依頼する。
6. Reviewerは問題があれば `AUTOMATION_BLOCKED`、問題がなければ `npm run review:lgtm` で最新HEADにLGTMを記録する。
7. AIの作業はここで終了する。
8. 人間が最終確認として `npm run pr:merge` を実行する。

## 信頼境界

- `main` への直接pushは禁止する。tracked pre-push hookで通常操作を拒否し、main push時のCIでも違反を検知する。ただしGitHub Free private repositoryではサーバー側branch protection相当の完全な強制ではない。
- AIは `npm run pr:merge` を実行しない。
- LGTMはPR番号と完全なHEAD SHAに紐付ける。新しいコミットが追加された時点で無効になる。
- レビュー証跡は `.git/foodfolio/review-proof.json` に保存し、tracked Git treeへ含めない。
- 人間のmergeコマンドは `--match-head-commit` を使用し、review後のHEAD変更をGitHub側でも拒否させる。

詳細な役割と停止条件は [review.md](review.md)、実装ルールは [development.md](development.md)、検証ルールは [testing.md](testing.md) を参照する。
