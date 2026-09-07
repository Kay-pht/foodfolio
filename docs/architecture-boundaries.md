# Backend アーキテクチャ境界

## 目的

Backend の層構造を「守るように注意するルール」ではなく、CI で壊れたことを検知できるルールにする。

実装設計の `src/domain`、`src/application`、`src/infrastructure`、`src/api`、`src/entrypoints` という責務分離を前提とする。

## 現在の機械チェック対象

`npm run check:architecture` は、`src/**/*.ts` の相対 import / export を調べ、次の外向き依存を禁止する。

| import 元 | import 禁止先 |
| --- | --- |
| `domain` | `application`, `infrastructure`, `api`, `entrypoints` |
| `application` | `infrastructure`, `api`, `entrypoints` |
| `infrastructure` | `api`, `entrypoints` |
| `api` | `entrypoints` |
| `entrypoints` | なし |

つまり外側の層から内側の層を利用することは許可するが、内側の層が外側の実装詳細を直接参照することは禁止する。

## 今回は機械チェックしないもの

次は既存実装との整合を確認しながら別途強化するため、現時点では禁止しない。

- `application` から Prisma generated client への依存
- `config`, `generated`, `shared` の詳細な依存方向
- 外部 npm package や Node.js built-in module への依存可否
- ファイル名やファイル配置の細かな命名規則

特に現行の `src/application/analysis/analysis-service.ts` は Prisma client を直接利用している。実装設計では Domain / Application を外部 SDK から分離する方針だが、この差異を解消するリファクタリングは本ガードレール導入とは分離する。

## ルール変更時

- 既存コードが満たしていることを確認してからルールを強化する。
- 新しい例外を増やすより、依存方向そのものを見直す。
- ルールを変更した場合は `scripts/check-architecture.mjs` とこの文書を同じ PR で更新する。
