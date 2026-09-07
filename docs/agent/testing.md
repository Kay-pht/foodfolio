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

- `npm run check:architecture`: Backend の層間依存を検証する。
- `npm run check:docs`: エージェント向け正本文書のリンク・npm script と docs 索引を検証する。

iOS の全体検証は `npm run verify:ios` を使用する。

検証を実行できない、または失敗した場合は未完了として、理由、失敗箇所、確認できた範囲を報告する。ローカル検証の成功を、CI、デプロイ、実環境での動作確認の成功として扱わない。

## ドキュメントのみの変更

ドキュメントやコメントなど、実装の動作に影響しない部分だけを変更した場合は、実行しても変更内容を検証できない全体テスト、結合テスト、E2E テスト、lint、build を省略してよい。

ただし、次の軽量チェックは必須とする。

- `npm run check:docs`: リンク切れ、索引漏れ、存在しない npm script 参照を確認する。
- Markdown の format check: Documentation workflow では、全依存の `npm ci` を避けるため、リポジトリで使用している Prettier 3.6.2 を直接実行する。対象は変更された Markdown ファイルに限定し、`.prettierignore.markdown` により既存の生成物除外を維持しながら、Backend 用の `.prettierignore` にある `docs/` 除外は適用しない。

ドキュメントのみの変更では、Backend 全体向けの `npm run format:check` は省略してよい。これは task file check や非 Markdown ファイルを含む全体検証であり、Documentation workflow の Markdown format check がドキュメント変更に対する format 完了条件を満たすためである。

省略した検証と理由は完了報告に明記する。

## 実行頻度

全体検証は変更のたびに繰り返さず、大きな変更単位がまとまった時点で実行する。途中確認が必要な場合は、変更箇所を直接対象とするテストや個別チェックを優先する。
