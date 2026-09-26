# Runtime monitoring

Foodfolio の初期ランタイム監視は Google Cloud Monitoring で管理し、ランタイム障害だけを Slack `#foodfolio-alerts` へ通知する。

GitHub Actions、Quality、Deploy、PR、commit の通知とは分離する。アプリケーションから Slack API、Bot、Incoming Webhook を直接呼び出さない。

## 対象環境

- GCP project: `foodfolio-af28aa`
- Cloud Run API: `foodfolio-dev-api`
- Cloud Run Worker: `foodfolio-dev-worker`
- Terraform state: 既存の dev state
- 通知先: Slack `#foodfolio-alerts`

## 反映状況

2026-09-24に既存dev Terraform stateを使い、PR #121/#122の5 alert policiesを対象限定で適用した。適用planは`0 add / 5 update / 0 destroy`で、Cloud Run service、Slack notification channel、その他のGCP resourceは変更していない。

適用後、Cloud Monitoring APIから次を再取得した。

- alert policyは5件すべて有効
- 5件すべてが既存Slack notification channel `#foodfolio-alerts`を参照
- API uptime、API 5xx、API memory、Worker memoryの日本語subjectを確認
- Recipe Analysis final failureの日本語subject、30分auto-close、8つの非機密label extractorを確認
- API `/health`は`{"status":"ok"}`、API / Workerは適用前と同じrevisionへtraffic 100%

意図的な障害、5xx、OOM、Recipe Analysis最終失敗は発生させていないため、実Slack通知の発火確認は行っていない。実障害発生時の通知と復旧通知は、incidentとログを照合して別途確認する。

## Slack Notification Channel

Slack Workspace、Slack channel、Google Cloud と Slack の OAuth 接続は Terraform 管理外とする。人間が Google Cloud Console の Cloud Monitoring から公式 Slack integration を設定する。

事前準備:

1. Slack に public channel `#foodfolio-alerts` を作成する。
2. `foodfolio-af28aa` の Cloud Monitoring で Slack notification channel を作成し、`#foodfolio-alerts` を選択する。
3. 作成された notification channel の full resource name を取得する。

形式:

```text
projects/foodfolio-af28aa/notificationChannels/XXXXXXXXXXXX
```

この resource name は OAuth token や webhook URL ではなく、Terraform はこの文字列だけを参照する。Slack notification channel resource 自体は Terraform で作成、import、更新、削除しない。

Terraform 実行時は、たとえば次のように input を渡す。

```bash
export TF_VAR_monitoring_slack_notification_channel='projects/foodfolio-af28aa/notificationChannels/XXXXXXXXXXXX'
```

現行の `.github/workflows/deploy-dev.yml` は Terraform を実行しないため、この値を deploy workflow へ追加しない。Terraform の自動 apply は本タスクの対象外とする。

## Alert policies

### Public API uptime

`GET /health` に対する HTTPS Uptime Check を使用する。レビュー時に稼働中の `foodfolio-dev-api` の両 Cloud Run URL で `/health` は 200 と `{"status":"ok"}` を返し、`/healthz` は Google Frontend の 404 を返したため、公開監視には `/health` を指定する。

- period: 60 seconds
- timeout: 10 seconds
- expected HTTP status: 2xx
- expected JSON: `$.status == "ok"`
- checker: public static IP checkers
- checker region を限定せず Cloud Monitoring の public checker locations を使用する
- CRITICAL: 同時に2 location以上が失敗した状態が60秒継続
- incident open / close を Slack 通知する
- 通知本文には、利用不能の影響、APIログとCloud Runメトリクスの確認順、close後に確認すべき内容を日本語で記載する

Cloud Monitoring は checker region を明示指定する場合に最低3 locationsを含む設定を要求するため、初版では `selected_regions` を固定しない。アラート側で失敗 location 数を集約し、単一 location の一時失敗では incident を開かない。

### API 5xx

独自 log-based metric は作成せず、Cloud Run の標準 metric `run.googleapis.com/request_count` を使用する。

対象:

- resource: `cloud_run_revision`
- service: `foodfolio-dev-api`
- `response_code_class="5xx"`
- ERROR: 5分の集計 window 内に3件以上
- 1件または2件の単発 5xx では incident を開かない
- incident open / close を Slack 通知する
- 通知本文には、一部の利用者操作が失敗していること、原因はアラート単体では確定できないこと、5xxへ絞ったログ確認手順を記載する

Cloud Monitoring の自動生成文に表示される response class と、policy が監視する class の取り違えを避けるため、集約後にも `metric.label.response_code_class` を保持する。policy の filter と通知本文は5xxだけを対象とする。

この標準 metric は Cloud Run container instance まで到達した request を数える。Cloud Run 側で container 到達前に拒否された request はこの signal には含まれない。

### Recipe Analysis final failure

Worker の既存 structured log を直接 LogMatch alert で監視する。log-based counter metric は作成しない。

filter の中心条件:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="foodfolio-dev-worker"
jsonPayload.analysisStatus="failed"
```

`analysisStatus="pending"` は Cloud Tasks retry が残る状態なので対象外とする。

- severity: ERROR
- 最初の final failure で incident を開く
- notification rate limit: 1 hour
- final failure log には、アプリケーションが管理する値だけから `target`、`summary`、`impact`、`retryPolicy`、`nextAction` を追加する
- Slack には `errorCode`、正規化した `provider`、`analysisAttempt` と上記の対応情報を展開する
- `provider` が存在しない取得段階の失敗では `not_applicable` を記録し、label extraction に必要なフィールドを欠落させない
- Z.ai失敗では、利用可能な範囲で `aiFailureStage`、`model`、`providerRequestId`、`providerHttpStatus`、`providerFinishReason`、`latencyMs`、token数、response文字数、schema検証メタデータを同じ構造化ログへ記録する
- `aiFailureStage` は transport / HTTP / response envelope / content / schema のどこで失敗したかを、アプリケーション管理の固定値で表す。Provider由来の任意メッセージは記録しない
- Slack へ recipe ID、source URL、request body、認証情報、例外メッセージ等の利用者データや任意文字列を展開しない
- Cloud Loggingにもsource本文、prompt、署名付きmedia URL、AI response本文、raw error bodyを記録しない。responseは文字数、正規化済みfinish reason、固定schemaのkeyword/pathだけを診断に利用する
- 通知の「次に行うこと」は、エラー分類に対応するログと依存先の確認手順を示す。通知だけで根本原因を断定しない

LogMatch policy の notification rate limit は Cloud Monitoring の log-based alert 機能で適用する。

Recipe Analysis final failure は単発イベントであり、incident の自動closeは復旧を意味しない。Worker内の自動再試行が終了した時点で通知し、再実行が必要かどうかはエラー分類とログに基づいて判断する。

### API / Worker high memory

Cloud Run 標準 metric `run.googleapis.com/container/memory/utilizations` を使用し、API と Worker を別々の policy にする。

- 60秒ごとに p99 を評価
- 複数 revision が存在する場合は service 内の最大値を使用
- WARNING: utilization `> 0.9` が5分継続
- missing data は inactive と扱う
- incident open / close を Slack 通知する
- API と Worker の各通知には、想定される影響、Cloud Runメトリクスと対象ログの確認順、close後にもOOMや失敗処理を確認する必要があることを記載する

Cloud Run が scale-to-zero して metric が存在しない状態は high memory とみなさない。

## Severity

| Severity   | 対象                                            |
| ---------- | ----------------------------------------------- |
| `CRITICAL` | Public API が複数 location から継続して利用不能 |
| `ERROR`    | API 5xx の継続発生、Recipe Analysis の最終失敗  |
| `WARNING`  | API / Worker の memory utilization 高止まり     |

INFO 通知は初版では作成しない。

## 実装境界

Terraform が管理するもの:

- `monitoring.googleapis.com`
- `logging.googleapis.com`
- Uptime Check
- Alert Policies
- 外部 Slack notification channel resource name への参照

Terraform が管理しないもの:

- Slack Workspace / channel / OAuth connection
- Slack Bot / Incoming Webhook
- Email notification channel
- GitHub / CI/CD notification
- Firebase / APNs user notification
- Billing alert の新設・変更

API `/health` は既存のまま利用する。Recipe Analysis の既存 final failure log には、Slackで初動判断できる非機密の運用フィールドを追加する。解析結果、再試行判定、利用者向け通知の挙動は変更しない。

## Validation

コード側では最低限以下を確認する。

```bash
npm run check:specs
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
npm run verify
```

remote state を使った plan を行う場合は、上記 Slack notification channel resource name に加え、既存 Terraform が要求する image variables 等も正しい値で与える。`terraform plan` では Cloud Run API / Worker や Cloud Tasks の意図しない置換・変更がないことを確認する。

このPRでは `terraform apply` を実行しない。実環境へ反映した後は Cloud Monitoring の notification channel test で `#foodfolio-alerts` への到達を確認し、各 policy が enabled であることを確認する。意図的な API outage や OOM は発生させない。
