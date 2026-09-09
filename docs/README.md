# Foodfolio ドキュメント索引

このファイルを Foodfolio のドキュメント入口とする。実装時は目的に応じて正本文書へ進み、同じ情報を複数文書へ重複して増やさない。

## 要件・設計の正本

| 目的             | 文書                                                           |
| ---------------- | -------------------------------------------------------------- |
| MVP の要件       | [requirements-specification.md](requirements-specification.md) |
| 基本設計         | [basic-design.md](basic-design.md)                             |
| UI / UX          | [ui-ux-design.md](ui-ux-design.md)                             |
| 技術選定         | [technology-selection.md](technology-selection.md)             |
| 実装設計         | [implementation-design.md](implementation-design.md)           |
| 画像再取得       | [image-recovery.md](image-recovery.md)                         |
| Backend 層間依存 | [architecture-boundaries.md](architecture-boundaries.md)       |

変更タスク単位の検証可能な契約は [../specs/README.md](../specs/README.md) と `specs/tasks/*.yaml` を使用する。

## 開発・運用

| 目的                         | 文書                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| 開発プロセス                 | [dev-flow.md](dev-flow.md)                                     |
| ローカル Backend             | [local-development.md](local-development.md)                   |
| 解析依頼の受付制御           | [analysis-admission-control.md](analysis-admission-control.md) |
| AI データ取扱い              | [ai-data-handling.md](ai-data-handling.md)                     |
| Share Extension セットアップ | [share-extension-setup.md](share-extension-setup.md)           |
| TestFlight 準備              | [testflight-preparation.md](testflight-preparation.md)         |
| テストケース改善方針         | [test-case-improvement.md](test-case-improvement.md)           |
| デザイン改善メモ             | [../design-improvement.md](../design-improvement.md)           |

## エージェント向け運用ルール

- [P0 自律開発ガードレール](agent/autonomous-p0.md)
- [開発フロー](agent/development.md)
- [AIレビューと停止条件](agent/review.md)
- [テストと検証](agent/testing.md)
- [インフラと外部操作](agent/infrastructure.md)
- [リリース管理](agent/release.md)

ルートの [AGENTS.md](../AGENTS.md) は上記文書への入口として保ち、詳細ルールを増やしすぎない。

## PoC・調査結果

以下は判断根拠や過去検証の記録であり、現在仕様そのものではない。現在仕様と衝突する場合は、上の要件・設計文書を優先する。

- [ai-model-comparison.md](ai-model-comparison.md)
- [poc-validation-plan.md](poc-validation-plan.md)
- [poc-validation-results.md](poc-validation-results.md)
- [poc-instagram-media-results.md](poc-instagram-media-results.md)
- [poc-gemini-youtube-results.md](poc-gemini-youtube-results.md)
- [poc-gemini-youtube-v2-results.md](poc-gemini-youtube-v2-results.md)
- [poc-gemini-youtube-stability-results.md](poc-gemini-youtube-stability-results.md)
- [poc-gemini-youtube-description-results.md](poc-gemini-youtube-description-results.md)
- [poc-gemini-youtube-final-results.md](poc-gemini-youtube-final-results.md)

## 実装の主要な入口

- Backend: [../src](../src)
- API: [../src/api](../src/api)
- Application: [../src/application](../src/application)
- Domain: [../src/domain](../src/domain)
- Infrastructure: [../src/infrastructure](../src/infrastructure)
- iOS: [../ios/Foodfolio](../ios/Foodfolio)
- DB schema: [../prisma/schema.prisma](../prisma/schema.prisma)
- AI extraction schema: [../schemas/extracted-recipe.schema.json](../schemas/extracted-recipe.schema.json)

## 更新ルール

- 新しいトップレベル文書を `docs/` に追加した場合は、この索引にも追加する。
- 文書を移動・削除した場合は、この索引と `AGENTS.md` からの参照を同じ PR で更新する。
- 正本文書に `npm run ...` を記載する場合は、実在する package script 名を使う。
- `npm run check:docs` は、この索引の網羅性、エージェント向け文書のローカルリンク、記載された npm script の存在を検証する。
