# インフラ費用削減

## 設定方針

API / WorkerのCloud Runはリクエストベース課金を明示する。Terraformでは`cpu_idle = true`、dev deployでは`--cpu-throttling`を指定する。最小0台、最大2台、1 vCPU / 512 MiB、API 60秒 / Worker 600秒のdeadline、Cloud Tasksの再試行・同時実行数、Workerの内部ingressと認証、毎分のAPI外形監視は維持する。

WorkerはCloud TasksのHTTPリクエスト内で解析・通知・admission後処理の完了まで待ち、その後に204を返す。リクエスト外の常駐解析として扱わない。APIの`local-http` queueは応答後にdispatchするため、Cloud Runでは使わず、既存の`cloud-tasks`設定を維持する。

リクエストベース課金でも、起動・終了・リクエスト処理・該当するprobeには課金が発生する。外部AI応答の待ち時間もHTTP処理中に含まれる。削減額は無料枠、単価、起動回数、同時処理、実際の請求で確認し、リクエスト時間の合計だけから確定しない。

## PRと実環境反映の境界

初期導入（PR #136）の実装・PR作成では、Terraform apply、Cloud Run deploy、イメージ削除を実行しなかった。既存dev deployはAPIをデプロイ・確認してからWorkerをデプロイ・確認する。workflowと検証scriptだけの差分もデプロイ対象とする。現在の手動整理は、下記の保持条件とその回のユーザーの明示的な削除指示に従う。

deployはTerraformを実行しないため、Artifact Registryのdry-runポリシーは別のTerraform適用が必要。マージだけではArtifact Registryの設定は反映されない。

## デプロイ後の確認

`scripts/verify-cloud-run-deployment.mjs`は、`PROJECT_ID`、`REGION`、`IMAGE`、`IMAGE_DIGEST`と引数のサービス名を使い、`gcloud run services describe` / `gcloud run revisions describe`のみで確認する。Ready状態、最新作成revisionと最新Ready revisionの一致、最新Ready revisionへのtraffic 100%、期待image、templateと配信中revisionのリクエストベース課金を検証する。Cloud Runのrevisionはtagをdigestへ解決するため、サービスtemplateは`IMAGE`、配信中revisionはpush後にArtifact Registryから取得した`IMAGE_DIGEST`と照合する。raw response、環境変数、secretは出力しない。annotation省略時はGoogleの定義に従いリクエストベース課金として扱う。

1. APIの配信中revisionと課金設定を確認し、`/health`、認証付きAPIの取得・保存・同期が成功することを確認する。
2. Workerの配信中revisionと課金設定を確認する。解析依頼を送り、DBのterminal状態・通知・HTTP応答を照合する。成功のacknowledgement前に解析と後処理が完了し、再試行可能な失敗は503を返すことを確認する。
3. OOM、5xx、解析失敗率、処理時間、通知、DB接続を比較する。意図的な本番障害や実利用者へのテスト通知は発生させない。
4. 変更後7日間のMonitoring課金対象時間をAPI / Worker別に取得し、変更前と比較する。円額は請求の反映後に確認し、異なる利用量や無料枠消費を区別する。
5. エージェントがデプロイ結果を確認する際は、下記の手動整理チェックも行い、削除候補があれば現在のチャットで報告する。

このチェックはローカルのmock / E2E検証と区別する。実環境で未実施の確認を完了と報告しない。

## Artifact Registryのdry run

対象はFoodfolioの既存`foodfolio`リポジトリ。Terraformに次の3ポリシーを置き、`cleanup_policy_dry_run = true`を固定する。

| ポリシー           | 条件                                              |
| ------------------ | ------------------------------------------------- |
| 削除候補           | 作成から30日より古いversion。tagの有無を問わない  |
| 最新versionの保持  | 各packageの最新10件。package prefixの制限なし     |
| 保護イメージの保持 | `keep-`で始まるtag付きversion。経過日数を問わない |

KEEPはDELETEより優先する。最新10件はpackageごとのversion数であり、過去の全デプロイや任意の古いrollback digestを自動で保証するものではない。現在のAPI / Workerは同じ`app` packageを使う。

2026-10-04の読み取り確認では、`keep-`タグ付きイメージは0件だった。保持ポリシーの定義だけでは、既存の稼働中・rollback用イメージにタグは付かない。dry runの導入時点では削除も保存費用の削減も発生しない。

最新10件は既存ポリシーのdry-run上の保持条件であり、以下の手動整理で保持する「確認済み公開版3つ」とは別である。手動整理のためにTerraformの保持数やdry-run設定を変更しない。

## 手動整理の運用

新しいCloud Run Job、Cloud Scheduler、定期GitHub Actions、定期通知は作成しない。既存deploy workflowにも自動削除や清掃確認stepを追加しない。エージェントがデプロイ後の確認またはインフラ保守を行う際に読み取り確認し、削除候補がある場合は現在のチャットでユーザーへ報告する。デプロイもエージェント作業もない期間には確認・通知を行わない。

### 保持条件

対象は`foodfolio-af28aa` / `asia-southeast1`の`foodfolio-dev-api`、`foodfolio-dev-worker`と、Artifact Registry `foodfolio`の`app` packageとする。別のservice、job、region、packageからの参照が見つかった場合は参照元も保護し、判断できなければ削除を中止する。

| 対象                    | 保持するもの                                                                                                                                   | 削除候補                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Cloud Run revision      | サービスごとの最新3つの確認済み公開revision、全traffic対象、traffic tag付きrevision、latest created / latest Ready、作成から30日以内のrevision | 保持対象以外で作成から30日超のrevision |
| Artifact Registry image | 残存する全revision / jobが参照するdigest、`keep-`タグなど明示的に保護したdigest、残す親manifestが参照する子manifest、作成から30日以内のversion | 保持対象以外で作成から30日超のversion  |

「確認済み公開版」は`scripts/verify-cloud-run-deployment.mjs`によるReady、配信先100%、期待imageとimmutable digestの照合が成功したrevisionを指す。アプリケーションの認証付き操作やWorker解析の成功を意味しない。同一revisionの再確認やデプロイをskipした成功workflowは別の公開版として数えない。順序はrevisionの作成時刻で判断する。年齢はUTCの時刻差で30 × 24時間と比較し、ちょうど30日は保持する。

通常、最新3つには現在配信中の版が含まれる。古い版へrollbackした場合、その配信版を追加で保持する。30日以内やplatform上の保護条件でも残るため、全体の保持数を3件には制限しない。

### デプロイ後の読み取り確認と報告

1. 最新のservice、全revision、job、registry versionとtagを再取得する。serviceとjobの一覧は全regionを確認し、対象repositoryを参照する別resourceがないか確認する。実行中・待機中のデプロイ、取得失敗、不明なdigestや参照、欠落した一覧があれば削除候補の確定を止め、確認できなかった内容を報告する。
2. サービスごとに最新3つの確認済み公開revisionを、成功確認ログとdigest照合を根拠に特定する。履歴のReady状態だけでは認定しない。3つ揃わない場合は新方式の記録が揃うまで削除を開始しない。
3. 成功確認時刻（JST）、service、revision、Git SHA、期待digest、成功確認の根拠（workflow Run URLや保存済みの検証結果）をリリース記録または整理記録へ残す。ログが期限切れでも根拠が残るよう、環境変数・secret・raw responseを含めず記録する。
4. service別のrevision総数、30日超の候補数と最古の作成時刻、保護revision / digest、不要image候補の数とサイズを報告する。候補が1件以上あれば整理を提案する。image sizeの合算は共有layerを重複して数えるため、実際の解放容量や請求削減額として報告しない。
5. 削除許可がない場合は候補報告までとする。今回の明示的な削除指示は今回の対象に限り、将来の整理への包括的な許可として扱わない。候補なしの場合は通常の作業報告に短く記載する。

読み取りには対象を明示したCLIを使う。出力はname、作成時刻、traffic、Ready、digest、tag等の必要項目へ限定する。

Jobの全region一覧は`--region`を指定せず取得する。`--region asia-southeast1`付きの一覧だけで他regionの参照がないとは判断しない。Jobが存在する場合は、そのJobの所在regionを指定して詳細を取得し、全container imageの参照を照合する。

```bash
gcloud run services list --platform managed --project foodfolio-af28aa
gcloud run revisions list --service foodfolio-dev-api --region asia-southeast1 --project foodfolio-af28aa
gcloud run revisions list --service foodfolio-dev-worker --region asia-southeast1 --project foodfolio-af28aa
gcloud run jobs list --project foodfolio-af28aa
gcloud artifacts docker images list asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app --include-tags --project foodfolio-af28aa
```

### 許可を得た回の削除手順

1. 削除前に候補と保持対象を確定し、対象revision名・digest・作成時刻・tag・確認済み公開版の証拠を保存する。ユーザーが既に今回の削除を明示的に指示している場合は同じ許可を再度求めない。
2. 実行中・待機中のデプロイがないこととserviceの配信先・latest revisionが計画から変わっていないことを再確認する。各削除直前にも対象revisionの年齢と保護条件を再取得して照合し、同時デプロイ・rollback・不一致を検出したら以降を中止する。
3. 対象revisionだけを削除する。service、repository、Terraform resource、DB、ユーザー画像、secretは削除しない。CLIが失敗した場合は続行せず、実行済み分を記録する。
4. 残存する全revision / jobからdigestを再取得し、保持imageが存在することを確認する。親indexと子image / attestation manifestの参照も照合し、不要な親から先に削除する。子manifestは全ての残存する親から未参照であることを再確認してから削除する。
5. digest指定で対象versionだけを削除する。削除対象versionに付いているtagの除去も今回の削除範囲に含む。`keep-`タグ等の保護が追加されていた場合、未参照であると確認できない場合、新しいデプロイが始まった場合は以降を中止する。保持imageのtagを移動・削除しない。
6. 再取得した一覧と削除前の一覧を比較し、予定したrevision / digestだけが消えたこと、全保持imageの存在、配信中revision・traffic・digestの維持、API `/health`の成功、`cleanup_policy_dry_run = true`の維持を確認する。解析依頼や利用者への通知を検証のために発生させない。
7. 確認日、許可の対象、根拠、削除一覧、前後の件数、失敗や未確認事項を整理記録へ残す。削除後のストレージ表示や請求には反映遅延があるため、削除成功と費用削減の確認は分ける。

revision削除は取り消せず、そのimageも自動では削除されない。削除済みrevisionへそのままrollbackすることはできない。必要なら保存済みのsourceと設定から新しいrevisionとして再デプロイする。

初回の確認済み公開版、削除一覧、前後の件数、実環境の再取得確認は [2026-10-05の整理記録](infrastructure-cleanup-2026-10-05.md) に記載する。以後も整理を行った回の記録を残す。

### 自動削除へ方針を変更する場合の前提

現在は自動削除を採用しない。将来方針を変更する場合、手動削除の許可とは別に、自動削除の有効化について明示的に許可を得る。次をすべて確認してから、設定変更をレビューする。

1. API / Workerのtraffic対象revisionと、rollback用として残すrevisionを列挙し、各imageのdigestを取得する。古い稼働imageやsplit trafficも対象にする。
2. 必要な全digestに、一意の保護tag（例：`keep-<digest識別子>`）を追加し、tagが対象digestを指すことを再取得して確認する。既存保護tagを別digestへ移動しない。新しいデプロイ・rollbackでもこの手順を継続する。
3. dry-runの監査ログで削除候補を確認し、必要な全digestとその親manifestが候補に含まれないことを照合する。Dockerの子imageは親manifest参照との関係も確認する。
4. データ書き込み監査ログが無効なら、dry-run結果取得のための設定変更とログ費用を別途判断する。ポリシーの反映・実行には通常約1日かかる。ログがないことを「削除候補なし」と扱わない。
5. 保持条件と削除対象の確認後に限り、dry run解除を別変更として行う。保護tagの廃止も、対象digestが不要と確認できた場合のみ行う。

## Terraformの検証・適用

ローカルとQuality CIは、backendを無効にしたinit、validate、mock providerによるplan testを実行する。mock testはライブGCPやTerraform stateにアクセスしない。

providerの選択versionは維持し、lockfileにHashiCorp署名を確認したLinux / macOSのチェックサムを保持する。CIのreadonly initでplatformのチェックサム不足が発生した場合は、同じversionに対して`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`で補う。検証を通すためにreadonlyを外したり、providerをupgradeしたりしない。

```bash
terraform -chdir=infra/terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform test
```

実環境適用時は既存stateを使い、稼働imageと既存Slack channelをinputとしてplanを作成する。対象はAPI / Workerの課金設定とArtifact Registryのdry runのみ。IAM、secret、image、監視などの無関係な変更やdestroy / replaceが含まれた場合は適用しない。deploy workflowにTerraformの自動applyは追加しない。

## ロールバック

API / Workerの課金方式による不具合では、必要なサービスだけインスタンスベース課金へ戻す。workflowの`--cpu-throttling`、Terraformの`cpu_idle`、リクエストベース課金を要求する検証scriptも同じrollback変更で整合させ、次のデプロイで設定が戻されないようにする。API契約、Cloud Tasksのretry / deadline、解析状態・通知は変更しない。

Artifact Registryの標準cleanup policyはdry runを維持する。ユーザーが許可した手動削除は別操作として記録し、dry runであることを手動削除も実施していない根拠にはしない。ポリシーを戻す場合も、同じstateに対するplanでリポジトリ自体が削除されないことを確認する。

## 公式仕様

- [Cloud Runの課金設定](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Cloud Run料金と課金対象時間](https://cloud.google.com/run/pricing)
- [Artifact Registryのcleanup policyとdry run](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Cloud Run revisionの保持と削除](https://docs.cloud.google.com/run/docs/managing/revisions)
- [Artifact Registry imageの削除](https://docs.cloud.google.com/artifact-registry/docs/docker/manage-images)
- [全regionのCloud Run Job一覧取得](https://docs.cloud.google.com/sdk/gcloud/reference/run/jobs/list)
- [Terraformのmock provider](https://developer.hashicorp.com/terraform/language/tests/mocking)
