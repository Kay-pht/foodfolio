# AIレビューと停止条件

## 責務分離

人間がセッションを分離し、Implementer / Reviewer / Fixer を同一セッションで兼任させない。

- Implementer: 仕様に基づく実装、テスト追加、検証、コミットを行う。自分の実装に最終LGTMを出さない。
- Reviewer: fresh context で仕様、PR差分、関連コード、検証結果を確認する。コードを変更しない。結果は `LGTM` または `AUTOMATION_BLOCKED` のみとする。
- Fixer: Reviewer の具体的な指摘だけを修正し、必要な検証を再実行する。修正後は別Reviewerセッションで再レビューする。

AIエージェントは最終マージを実行しない。マージは人間だけが行う。

## Reviewerの入力

Reviewer は少なくとも次を独立に確認する。

1. ユーザー要求と対応する `specs/tasks/*.yaml`
2. PRの最新HEAD SHA
3. PR差分と関連コード
4. 変更を直接検証するテスト
5. CIおよびローカル検証結果
6. 既存仕様、アーキテクチャ、セキュリティ制約との整合性

## LGTM

問題がなければReviewerは、現在のPR HEAD SHAに対してLGTMを記録する。

レビュー証跡はGit管理対象外の `.git/foodfolio/review-proof.json` に保存する。`npm run review:lgtm` を使用し、手作業でSHAを書き込まない。

LGTMは記録時点のHEAD SHAだけに有効である。新しいコミットが1つでも追加された場合、以前のLGTMは無効とし、再レビューする。

## AUTOMATION_BLOCKED

次のいずれかに該当する場合、Reviewerまたは作業エージェントはLGTMを出さず `AUTOMATION_BLOCKED` として停止し、理由と確認済み範囲を報告する。

- 必須CIまたは検証が失敗しており、自動修正対象として解消できない
- Specification as Code の検証に失敗する
- Reviewer blocker が残る
- 変更を直接検証できない、または必要なテストを実行できない
- 仕様と実装が矛盾する
- migration の安全性を確認できない
- security blocker が残る
- 必要な外部APIや外部サービス仕様を確認できない
- 想定外にスコープが拡大し、元仕様のまま安全に進められない
- 自動修正が既定上限に到達する

停止条件が解消された場合のみ、Fixerによる修正と別Reviewerセッションでの再レビューに進む。

## 人間による最終マージ

ReviewerのLGTM後、AIは作業を終了する。人間は固定コマンド `npm run pr:merge` を実行する。

このコマンドは、現在のPR、ローカルHEAD、レビュー証跡のPR番号と `reviewed_sha` の一致を確認し、`gh pr checks --watch --fail-fast` が成功した後、`gh pr merge --merge --delete-branch --match-head-commit <reviewed_sha>` を実行する。SHAは証跡から自動取得するため、人間が入力しない。

マージ成功後のみレビュー証跡を削除する。検証またはマージが失敗した場合は証跡を残し、原因を確認できるようにする。
