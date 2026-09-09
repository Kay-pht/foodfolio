# テストと検証

実装を終えただけではタスク完了としない。変更内容に応じて次を確認する。

1. 変更部分を直接対象とするテスト
2. 全体テスト
3. 結合テスト
4. E2E テスト
5. lint
6. format check
7. build

Backend を含む全体検証は `npm run verify` を使用する。このコマンドには次のガードレールも含む。

- `npm run verify:autonomous-p0`: Specification as Code、direct-main-push guardrail、SHA-bound review proofなどP0自律開発基盤を検証する。
- `npm run check:specs`: `specs/tasks/*.yaml` の契約、Requirement ID、verification path、bug regression metadataを検証する。
- `npm run check:architecture`: Backend の層間依存を検証する。
- `npm run check:docs`: エージェント向け正本文書のリンク・npm script と docs 索引を検証する。

iOS の全体検証は `npm run verify:ios` を使用する。

検証を実行できない、または失敗した場合は未完了として、理由、失敗箇所、確認できた範囲を報告する。ローカル検証の成功を、CI、デプロイ、実環境での動作確認の成功として扱わない。

## バグ修正の回帰テスト

バグ修正では、修正前に今回の不具合を直接再現するテストが失敗することを確認し、その後に修正して同じテストを成功させる `red -> fix -> green` を必須とする。

対応するbug specは `regression.required: true` と最低1件のテストパスを持つ。`npm run check:specs` はテストパスの存在を検証し、通常のテストコマンドとCIがそのテストの成功を検証する。最終CIだけから修正前REDを証明するのではなく、Implementerの作業記録としてRED確認結果を残す。

## Quality CI

GitHub Actions の Quality は既存どおり原則1job/1runnerで実行し、依存インストールやrunner起動の重複を避ける。Format、Lint、Architecture、Unit、Integration、E2Eなどは個別stepとして識別可能にする。

Auto Fix が失敗箇所を修正コミットする既存フローを維持するため、Quality は fail-fast のままとし、失敗したstepより後の高コスト検証を無条件に継続しない。

`main` へのpush時には direct-main-push policy も検証する。このCI検知はGitHub Free private repositoryでのserver-side branch protectionの代替ではなく、ローカルhookを迂回した誤操作を可視化する追加ガードレールである。

## ドキュメントのみの変更

ドキュメントやコメントなど、実装の動作に影響しない部分だけを変更した場合は、実行しても変更内容を検証できない全体テスト、結合テスト、E2E テスト、lint、build を省略してよい。

ただし、次の軽量チェックは必須とする。

- `npm run check:docs`: リンク切れ、索引漏れ、存在しない npm script 参照を確認する。
- Markdown の format check: Documentation workflow では、全依存の `npm ci` を避けるため、リポジトリで使用している Prettier 3.6.2 を直接実行する。対象は変更された Markdown ファイルに限定し、`.prettierignore.markdown` により既存の生成物除外を維持しながら、Backend 用の `.prettierignore` にある `docs/` 除外は適用しない。

ドキュメントのみの変更では、Backend 全体向けの `npm run format:check` は省略してよい。これは task file check や非 Markdown ファイルを含む全体検証であり、Documentation workflow の Markdown format check がドキュメント変更に対する format 完了条件を満たすためである。

省略した検証と理由は完了報告に明記する。

## 実行頻度

全体検証は変更のたびに繰り返さず、大きな変更単位がまとまった時点で実行する。途中確認が必要な場合は、変更箇所を直接対象とするテストや個別チェックを優先する。
