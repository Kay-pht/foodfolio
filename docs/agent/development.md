# エージェント開発フロー

## ブランチ

- 開発は必ずタスク専用のブランチを作成してから開始する。`main` 上で直接開発またはpushしない。
- 初回セットアップでは `npm run hooks:install` を実行し、tracked `.githooks/pre-push` を有効化する。`--no-verify` などでdirect-main-push guardrailを回避しない。
- ブランチ名は原則 `codex/<task-name>` とし、タスクの内容が分かる短い名前にする。
- ブランチ作成前に Git の状態を確認する。既存の未コミット変更がある場合は、それが今回のタスクに含まれるかを確認し、無断で破棄、上書き、退避しない。
- ユーザーが使用するブランチを明示した場合は、その指示を優先する。
- コミットは変更を論理的かつレビュー可能な単位に分け、無関係な変更を混ぜない。
- クラウド開発ではコミットごとにpushせず、実装・テスト・spec・ドキュメントなどまとまった変更単位でpushする。途中経過のcheckpointだけを目的としたpushは避ける。

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
- Pull Request は Draft で作成し、実装とReady前に実行可能な検証が完了するまで Draft のまま更新する。Draft中のPR更新ではAuto FixとQualityのrunnerを起動しない。
- 最終CIを開始するときにReady for reviewへ変更する。ReadyではAuto Fixを先に実行し、自動修正後の最終HEADに対してQualityを1回実行する。
- Ready後に修正が必要になった場合は、修正をpushする前にPRをDraftへ戻す。修正をまとめてpushし、Ready前の確認を終えてから再度Readyへ変更する。
- Implementerは自分の実装へ最終LGTMを出さない。実装と必要な検証が完了したら、自主的に新規の別チャットを作成してfresh contextの独立Reviewerへ依頼し、結果を待つ。同じ会話内のサブエージェントや実装会話のforkで代用しない。`npm run review:flow` で成功コマンド・対象SHA・終了コード・ログ参照も引き継ぎ、Reviewerは成功済みの検証を再実行しない。未検証の具体的な論点に対する追加検証だけ理由付きで認める。初回後の修正・再レビューは最大3回とする。チャット作成・待機・返却と停止時の手順は [review.md](review.md) に従う。承認済みの [アラート修正ハーネス](alert-repair.md) の案件は既存の独立セッション制御を維持する。

Backend の層間依存は [../architecture-boundaries.md](../architecture-boundaries.md) に従う。レビュー責務、LGTM証跡、停止条件は [review.md](review.md) に従う。

## レビューと修正

- Reviewerはコードを変更せず、仕様・最新HEAD SHA・差分・関連コード・テスト結果を独立に確認する。
- Reviewerはblockerを元の実装チャットへ返し、コードを変更せず停止する。元チャットは修正が必要な旨をユーザーに報告する。既存仕様に基づくバグはFixerとして自律的に修正してよいが、仕様変更の提案や期待動作が曖昧な指摘は必ず変更前にユーザーへ確認する。FixerはPRをDraftへ戻してから修正し、必要なローカル検証を経てpush・Readyへ戻し、最終HEADでCIを確認する。
- Fixerがコミットした後は以前のLGTMを使用せず、自主的に新規の別Reviewerチャットを作成して最新HEADを再レビューする。
- 問題がなければReviewerは `npm run review:lgtm` で最新HEADにLGTM証跡を作成する。
- AIエージェントの作業は `LGTM` または `AUTOMATION_BLOCKED` で終了する。最終マージは人間だけが `npm run pr:merge` で行い、AIはこのコマンドを実行しない。

## チェックリスト

- タスクに対応するチェックリスト（例: `tasks/todo.md`、Issue、ユーザー指定の計画書）を着手前に確認する。
- `tasks/todo.md` の最上位タスクを完了にした後は `npm run format` を実行し、`tasks/completed.md` へ自動で仕分ける。未完了の親タスク配下にある完了済み子タスクは、親とともに `tasks/todo.md` に残す。
- タスクの完了条件をすべて満たした後に限り、対応する項目を `- [ ]` から `- [x]` に更新する。
- 一部だけ完了した場合、検証が失敗した場合、または外部確認が残っている場合はチェックを入れない。
- 対応する項目が存在しない場合は、無関係な項目を更新しない。新しい項目の追加先が不明な場合はユーザーに確認する。

## LGTM時の外部タスクリスト同期

- Reviewerは最新PR HEADに対する `npm run review:lgtm` の成功後、作業終了前にローカル環境変数 `TASK_LIST_REPO_PATH` が指すTask-Listを参照する。これはObsidianのTask-List Vaultへのパスであり、Foodfolio内の `tasks/todo.md` とは別の管理先である。
- `TASK_LIST_REPO_PATH` はGit管理対象外の `.env.local` に設定する。既存ファイルの内容を保持して未定義のキーだけ追記し、ファイル全体や既存の設定を上書きしない。個人環境の絶対パスをGit管理対象ファイルへ記載しない。その他の端末固有設定は [インフラと外部操作](infrastructure.md#cli-実行時の固定ルール) に従う。設定例のキーは `.env.local.example` を参照する。
- 同期を行うシェルではFoodfolioルートから下記のように値を読み込む。`.env.local` はシェルスクリプトとして実行せず、Nodeのenv-file読み込みを使う。未設定・空値・参照先不存在の場合は同期を開始せず、ユーザーに設定を確認する。

```bash
TASK_LIST_REPO_PATH="$(node --env-file=.env.local --print 'process.env.TASK_LIST_REPO_PATH ?? ""')"
test -n "$TASK_LIST_REPO_PATH" && test -d "$TASK_LIST_REPO_PATH"
```

- まずTask-Listの `AGENTS.md` とGitの状態を読み、`Inbox.md` と `Projects/*.md` にある `[[Projects/Foodfolio|Foodfolio]]` の未完了タスクを確認する。今回のPRの要求・差分・検証結果と照合し、対応する完了条件をすべて満たす項目だけを完了にする。該当項目がなければ追加・変更しない。
- LGTMだけを根拠に、未実装のレビュー指摘、別の障害通知、デプロイ・公開・実機確認などが残る項目を完了にしない。判定できない項目は未完了のまま、対象と不足する根拠を示してこのチャットでユーザーへ質問する。Slack通知などの重複は、元通知URL・日時・対象を照合し、同じエラーコードだけで同一案件と扱わない。
- 更新にはTask-Listの `npm --prefix "$TASK_LIST_REPO_PATH" run task:update` を使用する。保存元を読み直し、`file`、1始まりの `line`、正確な `expectedLine`、`status: done` をJSONで渡し、`--dry-run` で確認してから保存する。既存の本文・Project・Priority・Due dateと、他者の未コミット変更を保持する。競合や結果未確定の場合は同Vaultのルールに従い、未確認の再試行・巻き戻しをしない。
- 保存後にTask-Listで `npm --prefix "$TASK_LIST_REPO_PATH" run lint:tasks` を実行し、今回更新した行だけをステージしてタスク内容の変更として直接コミットする。PRは不要とし、コミット本文には対応するFoodfolio PR URL、レビューしたSHA、完了判定の根拠を記録する。他の未コミット変更をコミットへ混ぜない。
- この外部Vaultのタスク内容更新・コミットはReviewerの同期作業として認める。レビュー対象のFoodfolioのコードやGit管理対象ファイルは変更しない。Foodfolio内のチェックリスト修正が必要ならImplementer / Fixerへ戻し、変更後のHEADで別Reviewerセッションによる再レビューを行う。
- Task-Listにアクセスできない、検証やコミットに失敗した、またはユーザーへの確認が残る場合、同期済みとは報告しない。LGTM対象SHA、更新したタスク、Task-Listのコミット、未解決の確認事項を完了報告に記載する。最終マージは引き続き人間だけが行う。

## 完了報告

- 変更した内容と主要ファイルを簡潔に示す。
- 実行したテストと各結果を示す。
- 未実行の確認、既知の問題、外部環境で必要な作業があれば明記する。
- 更新したチェックリスト項目を示す。
