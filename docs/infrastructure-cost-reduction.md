# インフラ費用削減

## 設定方針

API / WorkerのCloud Runはリクエストベース課金を明示する。Terraformでは`cpu_idle = true`、dev deployでは`--cpu-throttling`を指定する。最小0台、最大2台、1 vCPU / 512 MiB、API 60秒 / Worker 600秒のdeadline、Cloud Tasksの再試行・同時実行数、Workerの内部ingressと認証、毎分のAPI外形監視は維持する。

WorkerはCloud TasksのHTTPリクエスト内で解析・通知・admission後処理の完了まで待ち、その後に204を返す。リクエスト外の常駐解析として扱わない。APIの`local-http` queueは応答後にdispatchするため、Cloud Runでは使わず、既存の`cloud-tasks`設定を維持する。

リクエストベース課金でも、起動・終了・リクエスト処理・該当するprobeには課金が発生する。外部AI応答の待ち時間もHTTP処理中に含まれる。削減額は無料枠、単価、起動回数、同時処理、実際の請求で確認し、リクエスト時間の合計だけから確定しない。

## PRと実環境反映の境界

この変更の実装・PR作成では、Terraform apply、Cloud Run deploy、イメージ削除を実行しない。マージ後の既存dev deployはAPIをデプロイ・確認してからWorkerをデプロイ・確認する。workflowと検証scriptだけの差分もデプロイ対象とする。

deployはTerraformを実行しないため、Artifact Registryのdry-runポリシーは別のTerraform適用が必要。マージだけではArtifact Registryの設定は反映されない。

## デプロイ後の確認

`scripts/verify-cloud-run-deployment.mjs`は、`PROJECT_ID`、`REGION`、`IMAGE`、`IMAGE_DIGEST`と引数のサービス名を使い、`gcloud run services describe` / `gcloud run revisions describe`のみで確認する。Ready状態、最新作成revisionと最新Ready revisionの一致、最新Ready revisionへのtraffic 100%、期待image、templateと配信中revisionのリクエストベース課金を検証する。Cloud Runのrevisionはtagをdigestへ解決するため、サービスtemplateは`IMAGE`、配信中revisionはpush後にArtifact Registryから取得した`IMAGE_DIGEST`と照合する。raw response、環境変数、secretは出力しない。annotation省略時はGoogleの定義に従いリクエストベース課金として扱う。

1. APIの配信中revisionと課金設定を確認し、`/health`、認証付きAPIの取得・保存・同期が成功することを確認する。
2. Workerの配信中revisionと課金設定を確認する。解析依頼を送り、DBのterminal状態・通知・HTTP応答を照合する。成功のacknowledgement前に解析と後処理が完了し、再試行可能な失敗は503を返すことを確認する。
3. OOM、5xx、解析失敗率、処理時間、通知、DB接続を比較する。意図的な本番障害や実利用者へのテスト通知は発生させない。
4. 変更後7日間のMonitoring課金対象時間をAPI / Worker別に取得し、変更前と比較する。円額は請求の反映後に確認し、異なる利用量や無料枠消費を区別する。

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

### 将来の削除有効化の前提

削除有効化はこのPRの対象外であり、別途明示的に許可を得る。次をすべて確認してから、設定変更をレビューする。

1. API / Workerのtraffic対象revisionと、rollback用として残すrevisionを列挙し、各imageのdigestを取得する。古い稼働imageやsplit trafficも対象にする。
2. 必要な全digestに、一意の保護tag（例：`keep-<digest識別子>`）を追加し、tagが対象digestを指すことを再取得して確認する。既存保護tagを別digestへ移動しない。新しいデプロイ・rollbackでもこの手順を継続する。
3. dry-runの監査ログで削除候補を確認し、必要な全digestとその親manifestが候補に含まれないことを照合する。Dockerの子imageは親manifest参照との関係も確認する。
4. データ書き込み監査ログが無効なら、dry-run結果取得のための設定変更とログ費用を別途判断する。ポリシーの反映・実行には通常約1日かかる。ログがないことを「削除候補なし」と扱わない。
5. 保持条件と削除対象の確認後に限り、dry run解除を別変更として行う。保護tagの廃止も、対象digestが不要と確認できた場合のみ行う。

## Terraformの検証・適用

ローカルとQuality CIは、backendを無効にしたinit、validate、mock providerによるplan testを実行する。mock testはライブGCPやTerraform stateにアクセスしない。

```bash
terraform -chdir=infra/terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform test
```

実環境適用時は既存stateを使い、稼働imageと既存Slack channelをinputとしてplanを作成する。対象はAPI / Workerの課金設定とArtifact Registryのdry runのみ。IAM、secret、image、監視などの無関係な変更やdestroy / replaceが含まれた場合は適用しない。deploy workflowにTerraformの自動applyは追加しない。

## ロールバック

API / Workerの課金方式による不具合では、必要なサービスだけインスタンスベース課金へ戻す。workflowの`--cpu-throttling`、Terraformの`cpu_idle`、リクエストベース課金を要求する検証scriptも同じrollback変更で整合させ、次のデプロイで設定が戻されないようにする。API契約、Cloud Tasksのretry / deadline、解析状態・通知は変更しない。

Artifact Registryはdry runのため、このPRによる削除はない。ポリシーを戻す場合も、同じstateに対するplanでリポジトリ自体が削除されないことを確認する。

## 公式仕様

- [Cloud Runの課金設定](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Cloud Run料金と課金対象時間](https://cloud.google.com/run/pricing)
- [Artifact Registryのcleanup policyとdry run](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)
- [Terraformのmock provider](https://developer.hashicorp.com/terraform/language/tests/mocking)
