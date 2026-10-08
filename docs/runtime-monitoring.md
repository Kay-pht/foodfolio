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
- notification rate limit: 抽出ラベル値の組み合わせごとに1時間
- final failure log には、アプリケーションが管理する固定文と検証した数値メタデータから `target`、`summary`、`impact`、`retryPolicy`、`nextAction` を追加する
- Slack には `errorCode`、正規化した `provider`、`analysisAttempt` と上記の対応情報を展開する
- `provider` が存在しない取得段階の失敗では `not_applicable` を記録し、label extraction に必要なフィールドを欠落させない
- Z.ai失敗では、利用可能な範囲で `aiFailureStage`、`model`、`providerRequestId`、`providerHttpStatus`、`providerFinishReason`、`latencyMs`、token数、response文字数、schema検証メタデータを同じ構造化ログへ記録する
- Recipe Analysis失敗ログには `sourceUrl` を追加するが、Recipeのsource URLからuserinfo、query parameter、fragmentを除去したURLだけを記録する
- URL取得失敗では `sourceOperation`、`sourceFailureStage`、`sourceFailureClass`、`sourceHttpStatus`、`sourceRedirectCount` を利用可能な範囲で記録する。値はアプリケーション管理の固定分類と検証済み数値だけとし、redirect先URL、response body、例外メッセージは記録しない
- TikTokでは短縮URL解決を `tiktok_short_url`、oEmbed取得を `tiktok_oembed` として区別し、同じ `SOURCE_FETCH_FAILED` でも失敗したHTTP処理をCloud Loggingで判別できるようにする
- Instagramメディア取得失敗では `mediaFailureStage`、`mediaFailureClass`、`mediaHttpStatus`、`mediaIndex`、`mediaKind`、`mediaAttempt`、`mediaMaxAttempts` を利用可能な範囲で記録する。metadata取得、単一動画download、asset download/validate、GCS publish、local work directory prepare、local/published cleanupを固定値で区別し、media URL、HTTP header、署名URL、raw exceptionは記録しない
- source/media diagnosticsの各固定enum・検証済み数値は、アプリ側で日本語の `diagnosticDetail` に整形し、Recipe Analysis最終失敗のSlack通知にも「診断情報」として表示する。Slackへはraw diagnostic field、media URL、header、例外文を直接展開しない
- `aiFailureStage` は transport / HTTP / response envelope / content / schema のどこで失敗したかを、アプリケーション管理の固定値で表す。Provider由来の任意メッセージは記録しない
- Slackへ表示する分析対象URLは、利用者が保存した `originalUrl` から生成する専用の `sourceLink` に限定する。認証情報（userinfo）、fragment、クエリを除去し、既存の `youtubeVideoId` で識別できるYouTube URLだけは検証済み動画IDを持つ正規URL（`https://www.youtube.com/watch?v=...`）へ整形する。他のSNS・共有ページ・一般Webではパスを維持するが、必要性を確認できないクエリ識別子も除去する。Markdownリンクを壊す文字はpercent-encodeする
- `sourceLink` は最終失敗ログだけに記録し、`source_link` labelで抽出してSlackの「分析対象URL」欄へ表示する。不正URL、HTTP(S)以外、4096文字を超える入力は固定の「分析対象URLを取得できません。失敗ログを確認してください。」とする。リンク生成のための追加アクセスや短縮URL解決は行わない
- recipe ID、request body、認証情報、例外メッセージ等は引き続きSlackへ展開しない。Cloud Loggingの既存 `sourceUrl` は全クエリを除去する挙動を維持し、Slack labelや通知本文へ展開しない。今回許可するsource URLの表示は上記 `sourceLink` だけとする
- Cloud Loggingにもsource本文、prompt、署名付きmedia URL、AI response本文、raw error bodyを記録しない。responseは文字数、正規化済みfinish reason、固定schemaのkeyword/pathだけを診断に利用する
- 通知の `summary` と「次に行うこと」は、診断段階と既知のエラー分類から失敗内容と対応を具体的に示す。source/mediaの追加診断は `diagnosticDetail` を `diagnostic_detail` labelとして抽出し、Slackの「診断情報」欄へ表示する
- `providerFinishReason=length` の失敗では「出力トークン上限に達して生成が打ち切られた」と表示し、利用可能なら設定上限と実際の出力token数を付記する。「上限を超えた」とは表示しない
- Z.aiの `maxOutputTokens` はAPIへ送る `max_tokens` と同一の値を記録する。token数が欠落する場合は数値を補わない
- 通信・時間切れ・HTTP 429・5xx・リクエスト拒否・本文欠落・不正JSON・schema不一致を区別する。診断がないAI提供元エラーではHTTP詳細を断定しない
- 取得・共有会話・SNSメディアの既知のエラーは失敗した操作を示す。Instagramメタデータ取得失敗だけから年齢・地域・ログイン制限を特定しない。複数の原因を持つエラーは「詳細原因は未確認」と明示する
- 未知のエラーでは従来のログ調査案内へ戻す。既存のエラーコード・再試行・通知条件は変更しない。文面と分析対象URLリンクの実環境反映にはWorkerのデプロイと既存monitoring policyへのTerraform適用が必要。コード・ローカル検証だけでは実際のSlack通知は変更されない。`sourceLink` がない旧Workerのログを新テンプレートへ流さないよう、反映時はWorkerを先に更新する

LogMatch policy の notification rate limit は Cloud Monitoring の log-based alert 機能で適用する。通知は整形後の分析対象URLごとに受け取る方針とし、`source_link`、エラー分類、診断情報など、抽出ラベル値すべての組み合わせを通知の単位とする。同じ組み合わせの繰り返し通知は1時間に1回までに抑える。整形後のURLが違えば、同じエラー・診断内容でも1時間以内にそれぞれ通知できる。同じ整形後URLでもエラーや診断などの抽出ラベルが違えば別の通知単位になる。クエリ除去やYouTube正規化によって同じリンクになるURL、または同じ取得不可文になる入力は、元のURLが違うだけでは別の通知単位にならない。

これはpolicy全体を1時間に1回に制限する契約ではない。Cloud Monitoringのサービス上限（log-based policyごとに新規alertは毎分2件・1日20件、通知は1日20件）も適用されるため、すべてのURLへの通知到達を保証するものではない。抽出ラベルごとの通知単位と上限は [Google公式のalerting limits](https://docs.cloud.google.com/monitoring/quotas#alerting) を参照する。

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
