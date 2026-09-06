# ローカルバックエンド開発

Foodfolioの通常開発では、Cloud Tasks / Cloud RunへデプロイせずにAPI・Worker・PostgreSQLをローカルで動かせる。

```text
Foodfolio Local (iOS Simulator)
  -> http://127.0.0.1:8080 (Local API)
  -> LocalHttpAnalysisQueue
  -> http://127.0.0.1:8081 (Local Worker)
  -> PostgreSQL 18 (Docker)
  -> YouTube API / Z.ai / Gemini
```

Cloud Tasks、Cloud Run、Secret Manager固有の挙動は再現しない。これらは既存dev環境のE2Eで最終確認する。

## 初回準備

Docker Desktop、Node.js / npm、Xcodeを用意したうえで依存関係をインストールする。

```bash
npm ci
cp .env.local.example .env.local
```

`.env.local` に最低限次の実APIキーを設定する。

```dotenv
ZAI_API_KEY=...
YOUTUBE_API_KEY=...
```

YouTube Gemini fallbackをローカルでも確認するときだけ、`GEMINI_API_KEY` を設定して `YOUTUBE_GEMINI_FALLBACK_ENABLED=true` にする。

ローカルAPIもiOSから受け取ったFirebase ID tokenを実際に検証する。Firebase Admin SDKがApplication Default Credentialsを取得できる状態にしておく。Foodfolio用の認証をまだ作成していない場合は、例えば次を実行する。

```bash
gcloud auth application-default login
```

`GOOGLE_CLOUD_PROJECT=foodfolio-af28aa` は `.env.local.example` に含まれている。gcloudのglobal project設定を変更する必要はない。

## 起動

```bash
npm run dev:local
```

このコマンドは次を行う。

1. `postgres:18-alpine` をDocker Composeで起動する
2. PostgreSQLのreadyを待つ
3. Prisma Clientを生成し、既存migrationをローカルDBへ適用する
4. Workerを `127.0.0.1:8081` 用の `PORT=8081` で起動する
5. APIを `127.0.0.1:8080` 用の `PORT=8080` で起動する

API / Worker自体は既存のFastify entrypointをそのまま利用する。ローカル時だけ `ANALYSIS_QUEUE_DRIVER=local-http` と `NOTIFICATION_DRIVER=noop` を使う。

PostgreSQLコンテナを停止するときは次を使う。

```bash
npm run dev:local:down
```

DBデータはnamed volumeに保持されるため、`down` だけでは削除されない。

## iOS Simulatorから接続

Xcodeで共有scheme **Foodfolio Local** を選択して起動する。このschemeはRun時だけ次を注入する。

```text
API_BASE_URL=http://127.0.0.1:8080
```

通常の **Foodfolio** schemeとRelease設定は従来どおりdev Cloud Run URLを利用するため、ローカル開発設定がdev/TestFlightへ混入しない。

## ローカルqueueの挙動

`LocalHttpAnalysisQueue` はCloud Tasksの代わりにWorkerの既存endpointへHTTP POSTする。

- APIのenqueueはWorker完了を待たずに返す
- `x-cloudtasks-taskretrycount` を付与する
- Workerが5xxを返した場合は `MAX_ANALYSIS_ATTEMPTS` まで再試行する
- Workerと同じ10分上限でHTTP requestを打ち切る
- 4xxは設定・実装エラーとして再試行しない

これにより、Cloud Tasks自体を使わずに `URL保存 -> pending -> 非同期解析 -> DB更新 -> iOS同期` をデプロイ前に確認できる。

## ローカルで再現しないもの

- Cloud TasksのOIDC認証、rate limit、queue設定
- Cloud Run revision / IAM / networking
- Secret Manager注入
- 本番相当Push通知（ローカルWorkerではNo-op）
- TikTok動画fallbackのGCS経路（`.env.local.example` では無効）

これらを変更した場合、ローカル確認後に既存dev環境へデプロイし、`npm run test:dev:e2e` と必要な実機確認を行う。
