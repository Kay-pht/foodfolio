# Codex 開発方針

このファイルは、このリポジトリで作業する Codex などの開発エージェント向けの入口です。詳細ルールはリンク先を正本とし、このファイルには毎回必要な要点だけを置きます。

## タスク着手前

1. ユーザーの依頼、関連ドキュメント、既存実装、テスト、Git の状態を確認する。
2. タスクの目的、対象範囲、完了条件、対応するチェックリスト項目を特定する。
3. 機能追加、バグ修正、仕様変更、リファクタ、セキュリティ変更など挙動に影響する作業では、実装前に `specs/tasks/*.yaml` の Specification as Code を確定し、`npm run check:specs` を成功させる。仕様未確定のまま実装を開始しない。
4. 不足情報、矛盾、複数の解釈のうち、結果を大きく左右し、安全性・費用・外部サービス・後戻り困難な設計判断に影響する未解決事項がある場合に限り、実装前に具体的に質問する。
5. 安全に合理的な仮定を置ける軽微な点では停止せず、仮定と根拠を記録して進める。
6. 推測を事実として扱わず、判断はコード、設定、テスト、ログ、保存データ、実際の画面や外部サービスの応答など、確認できる根拠に基づける。

## 作業の基本ルール

- 開発は必ずタスク専用ブランチで行い、`main` へ直接コミットまたはpushしない。`--no-verify` などでdirect-push guardrailを回避しない。
- ブランチ名は原則 `codex/<task-name>` とする。
- 依頼された範囲に限定し、既存の設計、命名、型、フォーマット、テスト慣例に合わせる。
- ユーザーの既存変更を無断で破棄、上書き、退避しない。
- バグ修正では、修正前に今回の不具合を再現して失敗する回帰テストを用意し、修正後に成功することを確認する。対応するbug specには `regression.required: true` とテストパスを記録する。
- Pull Request は Draft で作成し、実装と必要な検証が完了してから Ready for review に変更する。
- Implementer は自分の実装に最終LGTMを出さない。Reviewerはfresh contextの別セッションでコードを変更せずにレビューし、必要ならFixerへ戻す。セッション分離は人間が行う。
- AIエージェントは最終マージを実行しない。`npm run pr:merge` は人間専用コマンドであり、エージェントは実行禁止とする。
- 詳細は [開発フロー](docs/agent/development.md) と [AIレビューと停止条件](docs/agent/review.md) を参照する。

## 設計・ドキュメント

- ドキュメントの入口は [docs/README.md](docs/README.md) とする。
- Specification as Code の契約は [specs/README.md](specs/README.md) と [specs/schema.json](specs/schema.json) を正本とする。
- Backend の層間依存ルールは [architecture-boundaries.md](docs/architecture-boundaries.md) を正本とする。
- 要件、基本設計、実装設計などが衝突する場合は、各文書で定義された優先関係に従う。
- 実装や運用ルールを変更した場合は、対応する正本文書も同じ PR で更新する。

## 検証

- 全体検証は `npm run verify` を使用する。
- Specification as Code は `npm run check:specs`、P0自律開発ガードレールは `npm run verify:autonomous-p0` で検証する。
- Backend の層間依存は `npm run check:architecture`、文書の機械チェックは `npm run check:docs` で検証する。
- iOS の全体検証は `npm run verify:ios` を使用する。
- 検証を実行できない、または失敗した場合は完了扱いにせず、理由と確認できた範囲を報告する。
- 詳細は [テストと検証](docs/agent/testing.md) を参照する。

## レビュー完了状態

- Reviewerは問題がなければ最新PR HEADに対して `npm run review:lgtm` を実行し、Git管理対象外のレビュー証跡へ `LGTM + reviewed_sha` を記録する。
- 新しいコミットが追加された場合、以前のLGTMは無効とし、別Reviewerセッションで再レビューする。
- 定義された停止条件に該当する場合はLGTMを出さず `AUTOMATION_BLOCKED` として停止する。
- AIの責務は `LGTM` または `AUTOMATION_BLOCKED` までで終了する。最終確認とマージは人間が行う。

## タスク・リリース管理

- 着手前に `tasks/todo.md` など、タスクに対応するチェックリストを確認する。
- 完了条件を満たした項目だけを完了にする。
- 配布物や稼働環境の挙動が変わる変更は、既存のリリース管理ルールに従う。
- 詳細は [リリース管理](docs/agent/release.md) を参照する。

## 外部サービス・環境操作

- Foodfolio 固有の GCP、Firebase、Neon、Xcode、Apple 関連の確定値、操作許可、禁止事項は [インフラと外部操作](docs/agent/infrastructure.md) を正本とする。
- 破壊的削除、他プロジェクトへの変更、明示された予算を大きく超える構成、秘密情報のローテーション、一般公開リリースは、明示的な許可なしに実行しない。

## 完了報告

- 変更した内容と主要ファイルを簡潔に示す。
- 実行したテストと各結果を示す。
- 未実行の確認、既知の問題、外部環境で必要な作業があれば明記する。
- 更新したチェックリスト項目を示す。
