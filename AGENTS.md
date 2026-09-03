# Codex 開発方針

このファイルは、このリポジトリで作業する Codex などの開発エージェント向けの指示です。

## タスク着手前

1. ユーザーの依頼、関連ドキュメント、既存実装、テスト、Git の状態を確認する。
2. タスクの目的、対象範囲、完了条件、対応するチェックリスト項目を特定する。
3. 不足情報、矛盾、複数の解釈のうち、結果を大きく左右し、安全性・費用・外部サービス・後戻り困難な設計判断に影響する未解決事項がある場合に限り、実装前に具体的に質問する。安全に合理的な仮定を置ける軽微な点では停止せず、仮定と根拠を記録して進める。
4. 不明点がなければ、不要な確認を挟まずタスクを進める。
5. 推測を事実として扱わない。判断はコード、設定、テスト、ログ、保存データ、実際の画面や外部サービスの応答など、確認できる根拠に基づける。

## ブランチ

- 開発は必ずタスク専用のブランチを作成してから開始する。`main` 上で直接開発しない。
- ブランチ名は原則として `codex/<task-name>` とし、タスクの内容が分かる短い名前にする。
- ブランチ作成前に `git status` を確認する。既存の未コミット変更がある場合は、それが今回のタスクに含まれるかを確認し、無断で破棄、上書き、退避しない。
- ユーザーが使用するブランチを明示した場合は、その指示を優先する。
- 実装をコミットする場合は、変更を論理的かつレビュー可能な適度な単位に分ける。無関係な変更や過大な変更を一つのコミットにまとめない。

## 実装

- 依頼された範囲に限定し、無関係な変更を加えない。
- 既存の設計、命名、型、フォーマット、テストの慣例に合わせる。
- バグ修正や仕様変更には、変更部分を直接検証するテストを追加または更新する。
- ユーザーの既存変更を尊重し、無断で元に戻さない。
- 実装中のcommit、push、Pull Request 作成は適切なサイズで行うこと。

## Foodfolio MVPの確定値と外部操作許可（必要がなくなったら随時ここの中の項目は削除する）

MVP作成段階に限り、次の値を使用する。

- アプリ名: `Foodfolio`
- Bundle ID: `com.keyukt.foodfolio`
- GCP Project ID: `foodfolio-af28aa`
- GCPリージョン: Project自体はグローバル。Cloud Run、Cloud Tasks、Artifact Registry等のリージョン指定が必要なリソースは `asia-southeast1` (Singapore) を使用する。
- GCP認証アカウント: `kei.patheng@gmail.com`
- GCP Billing Account ID: `01C106-36E5A8-E7EA38`
- GCP予算目安: 月額1,000円
- Neon Project ID: `patient-hill-48111601`
- Neonリージョン: `aws-ap-southeast-1` (Singapore)
- Neon PostgreSQL: 18
- Neon既定branch: `production`

初期TestFlightでは独立したProduction環境を構築せず、現在のGCP / Firebase / Neonバックエンド環境を利用する。Neonの`production`は現在利用している既存branch名であり、独立したProduction環境が存在することを意味しない。利用者数や運用上の必要性が生じた段階で、Production環境の分離を再検討する。

初回TestFlightではPush通知を必須機能とする。Firebase AnalyticsとFirebase Crashlyticsは導入せず、リリース前にiOS targetから両SDKの依存を外して、TestFlight標準のセッション、クラッシュ、フィードバックを利用する。独自利用規約は作成せず、Apple標準EULAを使用する。認証の主要分岐は自動テストし、Apple / Google / メールの正常系を実機で各1回、Apple token失効を含むアカウント削除を実機で1回確認する。

CLI実行時は次を守る。

- `gcloud` の現在のglobal projectはFoodfolio以外を指しているため、Foodfolio向けコマンドでは必ず `--project foodfolio-af28aa` 等で対象を明示し、global設定を変更しない。
- Xcodeは `/Applications/Xcode.app` に導入済みだが、globalのactive developer directoryはCommand Line Toolsを指している。FoodfolioのXcodeコマンドでは `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` を指定し、global設定を変更しない。

MVP作成段階に限り、ユーザーは次の外部操作を明示的に許可している。対象をFoodfolio専用のリソースに限定し、既存の他プロジェクト・他アプリ・他データへ変更を加えない。

- GCP Project作成と上記Billing Accountへの紐付け
- Firebase有効化、Firebase iOS App登録、`GoogleService-Info.plist`取得
- 必要API、IAM、Service Account、Secret Manager、Artifact Registry、Cloud Run、Cloud Tasksの作成・設定
- TerraformによるFoodfolio MVPインフラのplan / applyとdev deploy
- Neonの認証情報が用意された後のFoodfolio用project / database / branch作成
- GitHub Actions、Workload Identity Federationの作成・設定
- Xcodeプロジェクト作成、Bundle ID設定、build、test、Simulator E2E
- Apple側の必要な手動準備が完了した後のApp Store Connectへのbuild uploadとTestFlight配布設定

この許可はMVP作成に必要な作成・更新・検証に限定する。既存リソースやデータの破壊的削除、他プロジェクトの変更、Billing Account自体の変更・解約、月額1,000円を明らかに超える構成、秘密情報のローテーション、一般公開リリースは含まない。これらが必要な場合のみユーザーへ確認する。

Apple Developer Program加入、規約同意、MFA、App Store Connectの新規アプリレコード作成、必要なAppleキーの初回発行はユーザーが行う。Backend・Core UI・Simulator中心の実装開始時には未完了でもよいが、次の期限までに完了している必要がある。

- Sign in with Appleの実環境検証前: Apple Developer Program、Team、Sign in with Apple設定
- Push通知の実機検証前: APNsキーとFirebaseへの登録
- 初回TestFlight upload前: App Store ConnectのFoodfolioアプリレコードと、CLI uploadに使用する認証設定

## 検証と完了条件

実装を終えただけではタスク完了としない。次のすべてを実行し、成功を確認する。

1. 変更部分を直接対象とするテスト
2. 全体テスト
3. 結合テスト
4. E2E テスト
5. lint
6. format check
7. build

このリポジトリでは、全体検証として `npm run verify` を実行する。検証を実行できない、または失敗した場合は、未完了として理由、失敗箇所、確認できた範囲を報告する。ローカル検証の成功を、CI、デプロイ、実環境での動作確認の成功として扱わない。

ただし、ドキュメントやコメントなど、実装の動作に影響しない部分だけを変更した場合は、実行しても変更内容を検証できないテスト、全体テスト、結合テスト、E2E テスト、lint、format check、build を省略してよい。この場合は、変更内容と差分を確認したうえで、ユーザーから依頼されていればテスト類を実行せずに commit、push まで進めてよい。省略した検証と、その理由を完了報告に明記する。
そして、これらの実行には時間を要することになるので、都度都度実行するのではなくて、大きな変更を完了した後で一度実行することが奨励される。都度実行したい場合は、その箇所だけのテストに限定するなど、なるべく時短を図ること。

## チェックリスト

- タスクに対応するチェックリスト（例: `tasks/todo.md`、Issue、ユーザー指定の計画書）を着手前に確認する。
- タスクの完了条件をすべて満たした後に限り、対応する項目を `- [ ]` から `- [x]` に更新する。
- 一部だけ完了した場合、検証が失敗した場合、または外部確認が残っている場合はチェックを入れない。
- 対応する項目が存在しない場合は、無関係な項目を更新しない。新しい項目の追加先が不明な場合はユーザーに確認する。

## 完了報告

- 変更した内容とファイルを簡潔に示す。
- 実行したテストと各結果を示す。
- 未実行の確認、既知の問題、外部環境で必要な作業があれば明記する。
- 更新したチェックリスト項目を示す。
