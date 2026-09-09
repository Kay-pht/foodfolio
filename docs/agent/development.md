# エージェント開発フロー

## ブランチ

- 開発は必ずタスク専用のブランチを作成してから開始する。`main` 上で直接開発またはpushしない。
- 初回セットアップでは `npm run hooks:install` を実行し、tracked `.githooks/pre-push` を有効化する。`--no-verify` などでdirect-main-push guardrailを回避しない。
- ブランチ名は原則として `codex/<task-name>` とし、タスクの内容が分かる短い名前にする。
- ブランチ作成前に Git の状態を確認する。既存の未コミット変更がある場合は、それが今回のタスクに含まれるかを確認し、無断で破棄、上書き、退避しない。
- ユーザーが使用するブランチを明示した場合は、その指示を優先する。
- コミットは変更を論理的かつレビュー可能な単位に分け、無関係な変更を混ぜない。

## Specification as Code

- 機能追加、バグ修正、仕様変更、リファクタ、セキュリティ変更など挙動に影響する作業では、実装前に `specs/tasks/*.yaml` を作成または更新する。
- Specには正常系だけでなく、異常系・境界値、security invariant、互換性、非機能要件、out-of-scope、acceptance criteria、検証先を記録する。
- Specは `status: approved` とし、`npm run check:specs` に成功してから実装へ進む。
- Requirement IDは検証先テストやチェックと紐付ける。検証先として記載したパスはリポジトリ内に実在しなければならない。
- バグspecでは `regression.required: true` とし、今回の不具合を直接再現する回帰テストを最低1件記録する。

## 実装

- 依頼された範囲に限定し、無関係な変更を加えない。
- 既存の設計、命名、型、フォーマット、テストの慣例に合わせる。
- バグ修正では、修正前に回帰テストが失敗することを確認してから修正し、修正後に同じテストが成功することを確認する。
- ユーザーの既存変更を尊重し、無断で元に戻さない。
- Pull Request は Draft で作成し、実装と必要な検証が完了するまで Draft のまま更新する。完了条件を満たした後に Ready for review へ変更する。
- Implementerは自分の実装へ最終LGTMを出さない。実装後のレビューは人間がfresh contextの別Reviewerセッションへ依頼する。

Backend の層間依存は [../architecture-boundaries.md](../architecture-boundaries.md) に従う。レビュー責務、LGTM証跡、停止条件は [review.md](review.md) に従う。

## レビューと修正

- Reviewerはコードを変更せず、仕様・最新HEAD SHA・差分・関連コード・テスト結果を独立に確認する。
- Reviewerにblockerがあれば `AUTOMATION_BLOCKED` として停止する。Fixerは指摘された内容を修正し、必要な検証を再実行する。
- Fixerがコミットした後は以前のLGTMを使用せず、別Reviewerセッションで最新HEADを再レビューする。
- 問題がなければReviewerは `npm run review:lgtm` で最新HEADにLGTM証跡を作成する。
- AIエージェントの作業は `LGTM` または `AUTOMATION_BLOCKED` で終了する。最終マージは人間だけが `npm run pr:merge` で行い、AIはこのコマンドを実行しない。

## チェックリスト

- タスクに対応するチェックリスト（例: `tasks/todo.md`、Issue、ユーザー指定の計画書）を着手前に確認する。
- `tasks/todo.md` の最上位タスクを完了にした後は `npm run format` を実行し、`tasks/completed.md` へ自動で仕分ける。未完了の親タスク配下にある完了済み子タスクは、親とともに `tasks/todo.md` に残す。
- タスクの完了条件をすべて満たした後に限り、対応する項目を `- [ ]` から `- [x]` に更新する。
- 一部だけ完了した場合、検証が失敗した場合、または外部確認が残っている場合はチェックを入れない。
- 対応する項目が存在しない場合は、無関係な項目を更新しない。新しい項目の追加先が不明な場合はユーザーに確認する。

## 完了報告

- 変更した内容と主要ファイルを簡潔に示す。
- 実行したテストと各結果を示す。
- 未実行の確認、既知の問題、外部環境で必要な作業があれば明記する。
- 更新したチェックリスト項目を示す。
