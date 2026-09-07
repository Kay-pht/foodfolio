# インフラと外部操作

## Foodfolio MVP の確定値

MVP 作成段階に限り、次の値を使用する。

- アプリ名: `Foodfolio`
- Bundle ID: `com.keyukt.foodfolio`
- GCP Project ID: `foodfolio-af28aa`
- GCP リージョン: Project 自体はグローバル。Cloud Run、Cloud Tasks、Artifact Registry 等のリージョン指定が必要なリソースは `asia-southeast1` (Singapore) を使用する。
- GCP 認証アカウント: `kei.patheng@gmail.com`
- GCP Billing Account ID: `01C106-36E5A8-E7EA38`
- GCP 予算目安: 月額 1,000 円
- Neon Project ID: `patient-hill-48111601`
- Neon リージョン: `aws-ap-southeast-1` (Singapore)
- Neon PostgreSQL: 18
- Neon 既定 branch: `production`

初期 TestFlight では独立した Production 環境を構築せず、現在の GCP / Firebase / Neon バックエンド環境を利用する。Neon の `production` は現在利用している既存 branch 名であり、独立した Production 環境が存在することを意味しない。利用者数や運用上の必要性が生じた段階で Production 環境の分離を再検討する。

## CLI 実行時の固定ルール

- `gcloud` の現在の global project は Foodfolio 以外を指しているため、Foodfolio 向けコマンドでは必ず `--project foodfolio-af28aa` 等で対象を明示し、global 設定を変更しない。
- Xcode は `/Applications/Xcode.app` に導入済みだが、global の active developer directory は Command Line Tools を指している。Foodfolio の Xcode コマンドでは `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` を指定し、global 設定を変更しない。

## MVP 期間中に許可されている外部操作

対象を Foodfolio 専用のリソースに限定し、既存の他プロジェクト・他アプリ・他データへ変更を加えない。

- GCP Project 作成と上記 Billing Account への紐付け
- Firebase 有効化、Firebase iOS App 登録、`GoogleService-Info.plist` 取得
- 必要 API、IAM、Service Account、Secret Manager、Artifact Registry、Cloud Run、Cloud Tasks の作成・設定
- Terraform による Foodfolio MVP インフラの plan / apply と dev deploy
- Neon の認証情報が用意された後の Foodfolio 用 project / database / branch 作成
- GitHub Actions、Workload Identity Federation の作成・設定
- Xcode プロジェクト作成、Bundle ID 設定、build、test、Simulator E2E
- Apple 側の必要な手動準備が完了した後の App Store Connect への build upload と TestFlight 配布設定

この許可は MVP 作成に必要な作成・更新・検証に限定する。次は含まないため、必要な場合のみユーザーへ確認する。

- 既存リソースやデータの破壊的削除
- 他プロジェクトの変更
- Billing Account 自体の変更・解約
- 月額 1,000 円を明らかに超える構成
- 秘密情報のローテーション
- 一般公開リリース

## Apple 側でユーザーが行う準備

Apple Developer Program 加入、規約同意、MFA、App Store Connect の新規アプリレコード作成、必要な Apple キーの初回発行はユーザーが行う。Backend・Core UI・Simulator 中心の実装開始時には未完了でもよいが、次の期限までに完了している必要がある。

- Sign in with Apple の実環境検証前: Apple Developer Program、Team、Sign in with Apple 設定
- Push 通知の実機検証前: APNs キーと Firebase への登録
- 初回 TestFlight upload 前: App Store Connect の Foodfolio アプリレコードと、CLI upload に使用する認証設定
