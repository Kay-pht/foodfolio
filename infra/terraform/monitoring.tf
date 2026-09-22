locals {
  api_uptime_host         = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
  api_logs_url            = "https://console.cloud.google.com/logs/query;query=${urlencode("resource.type=\"cloud_run_revision\"\nresource.labels.service_name=\"${google_cloud_run_v2_service.api.name}\"")}?project=${var.project_id}"
  api_5xx_logs_url        = "https://console.cloud.google.com/logs/query;query=${urlencode("resource.type=\"cloud_run_revision\"\nresource.labels.service_name=\"${google_cloud_run_v2_service.api.name}\"\nhttpRequest.status>=500")}?project=${var.project_id}"
  worker_failure_logs_url = "https://console.cloud.google.com/logs/query;query=${urlencode("resource.type=\"cloud_run_revision\"\nresource.labels.service_name=\"${google_cloud_run_v2_service.worker.name}\"\njsonPayload.analysisStatus=\"failed\"")}?project=${var.project_id}"
}

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "${local.name_prefix}-api-health"
  timeout      = "10s"
  period       = "60s"
  checker_type = "STATIC_IP_CHECKERS"

  http_check {
    path           = "/health"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.api_uptime_host
    }
  }

  content_matchers {
    content = "\"ok\""
    matcher = "MATCHES_JSON_PATH"
    json_path_matcher {
      json_path    = "$.status"
      json_matcher = "EXACT_MATCH"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "api_uptime" {
  display_name = "[foodfolio][CRITICAL] API unavailable"
  combiner     = "OR"
  severity     = "CRITICAL"

  documentation {
    subject   = "[要対応][CRITICAL] Foodfolio APIに接続できません"
    mime_type = "text/markdown"
    content   = <<-EOT
      ## 何が起きたか

      Foodfolio APIのヘルスチェックが2か所以上から60秒間失敗しています。利用者がAPIを使えない可能性があります。

      ## 最初に行うこと

      1. [APIログ](${local.api_logs_url})で通知時刻付近の起動失敗・例外・タイムアウトを確認する。
      2. [Cloud Run](https://console.cloud.google.com/run/detail/${var.region}/${google_cloud_run_v2_service.api.name}/metrics?project=${var.project_id})で稼働リビジョン、インスタンス数、エラー率を確認する。
      3. Google Cloudの障害でなければ、直前のデプロイと設定変更を確認する。

      ## 復旧通知

      `Alert closed` は複数拠点から `/health` が再び成功したことを示します。原因解消の証明ではないため、ログと主要API操作も確認してください。
    EOT
  }

  conditions {
    display_name = "At least two uptime checker locations fail"
    condition_threshold {
      filter = "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type = \"uptime_url\" AND metric.label.check_id = \"${google_monitoring_uptime_check_config.api_health.uptime_check_id}\""

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "60s"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    notification_prompts = ["OPENED", "CLOSED"]
  }

  notification_channels = [var.monitoring_slack_notification_channel]
  enabled               = true

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "api_5xx" {
  display_name = "[foodfolio][ERROR] API 5xx rate elevated"
  combiner     = "OR"
  severity     = "ERROR"

  documentation {
    subject   = "[要調査][ERROR] Foodfolio APIで5xxが増加しています"
    mime_type = "text/markdown"
    content   = <<-EOT
      ## 何が起きたか

      Foodfolio APIで5分間に3件以上の5xx応答が発生しました。一部の利用者操作が失敗しています。

      このアラートだけでは原因は確定できません。

      ## 最初に行うこと

      1. [5xxに絞ったAPIログ](${local.api_5xx_logs_url})で通知時刻付近のエラーとrequest IDを確認する。
      2. 同じエラーが継続しているか、失敗したAPIと影響件数を確認する。
      3. データベース、Cloud Tasks、外部APIなど依存先のエラーを確認する。

      ## 復旧通知

      `Alert closed` は5xx件数がしきい値を下回ったことを示します。失敗した処理の回復やデータ整合性はログで別途確認してください。
    EOT
  }

  conditions {
    display_name = "At least three API 5xx responses in five minutes"
    condition_threshold {
      filter = "metric.type = \"run.googleapis.com/request_count\" AND resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${google_cloud_run_v2_service.api.name}\" AND metric.label.response_code_class = \"5xx\""

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name", "metric.label.response_code_class"]
      }

      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    notification_prompts = ["OPENED", "CLOSED"]
  }

  notification_channels = [var.monitoring_slack_notification_channel]
  enabled               = true

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "recipe_analysis_final_failure" {
  display_name = "[foodfolio][ERROR] Recipe analysis final failure"
  combiner     = "OR"
  severity     = "ERROR"

  documentation {
    subject   = "[要調査][$${log.extracted_label.error_code}] $${log.extracted_label.target}が失敗しました"
    mime_type = "text/markdown"
    content   = <<-EOT
      ## 何が起きたか

      $${log.extracted_label.summary}

      ## 影響

      $${log.extracted_label.impact}

      ## 次に行うこと

      $${log.extracted_label.next_action}

      - エラー分類: `$${log.extracted_label.error_code}`
      - AI提供元: `$${log.extracted_label.provider}`
      - 最終試行回数: `$${log.extracted_label.analysis_attempt}`
      - 再試行状態: `$${log.extracted_label.retry_policy}`
      - [失敗ログ](${local.worker_failure_logs_url})

      この通知はWorker内の自動再試行が終了した最終失敗だけを対象にします。レシピID、URL、リクエスト本文、例外メッセージはSlackへ表示しません。
    EOT
  }

  conditions {
    display_name = "Recipe Analysis final failure log"
    condition_matched_log {
      filter = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.analysisStatus = \"failed\""
      label_extractors = {
        analysis_attempt = "EXTRACT(jsonPayload.analysisAttemptLabel)"
        error_code       = "EXTRACT(jsonPayload.errorCode)"
        impact           = "EXTRACT(jsonPayload.impact)"
        next_action      = "EXTRACT(jsonPayload.nextAction)"
        provider         = "EXTRACT(jsonPayload.provider)"
        retry_policy     = "EXTRACT(jsonPayload.retryPolicy)"
        summary          = "EXTRACT(jsonPayload.summary)"
        target           = "EXTRACT(jsonPayload.target)"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
    notification_rate_limit {
      period = "3600s"
    }
  }

  notification_channels = [var.monitoring_slack_notification_channel]
  enabled               = true

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "api_memory_high" {
  display_name = "[foodfolio][WARNING] API memory high"
  combiner     = "OR"
  severity     = "WARNING"

  documentation {
    subject   = "[要調査][WARNING] Foodfolio APIのメモリ使用率が高止まりしています"
    mime_type = "text/markdown"
    content   = <<-EOT
      ## 何が起きたか

      Foodfolio APIのコンテナメモリ使用率p99が90%を超えた状態で5分間継続しています。処理遅延やOOM終了につながる可能性があります。

      ## 最初に行うこと

      1. [Cloud Runメトリクス](https://console.cloud.google.com/run/detail/${var.region}/${google_cloud_run_v2_service.api.name}/metrics?project=${var.project_id})でメモリ、インスタンス数、リクエスト数を確認する。
      2. [APIログ](${local.api_logs_url})でOOM、再起動、特定処理の集中を確認する。
      3. 継続・再発する場合はメモリ増加の開始時刻と直前の変更を照合する。

      `Alert closed` は使用率がしきい値以下へ戻ったことを示します。OOMの有無と失敗リクエストはログで確認してください。
    EOT
  }

  conditions {
    display_name = "API memory utilization above 90 percent"
    condition_threshold {
      filter = "metric.type = \"run.googleapis.com/container/memory/utilizations\" AND resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${google_cloud_run_v2_service.api.name}\""

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.service_name"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0.9
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    notification_prompts = ["OPENED", "CLOSED"]
  }

  notification_channels = [var.monitoring_slack_notification_channel]
  enabled               = true

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "worker_memory_high" {
  display_name = "[foodfolio][WARNING] Worker memory high"
  combiner     = "OR"
  severity     = "WARNING"

  documentation {
    subject   = "[要調査][WARNING] Recipe Analysis Workerのメモリ使用率が高止まりしています"
    mime_type = "text/markdown"
    content   = <<-EOT
      ## 何が起きたか

      Recipe Analysis Workerのコンテナメモリ使用率p99が90%を超えた状態で5分間継続しています。解析遅延、再試行、OOM終了につながる可能性があります。

      ## 最初に行うこと

      1. [Cloud Runメトリクス](https://console.cloud.google.com/run/detail/${var.region}/${google_cloud_run_v2_service.worker.name}/metrics?project=${var.project_id})でメモリ、インスタンス数、リクエスト数を確認する。
      2. [Workerログ](${local.worker_failure_logs_url})でOOM、再起動、失敗した解析のエラー分類を確認する。
      3. 継続・再発する場合は対象リビジョンと直前の変更を照合する。

      `Alert closed` は使用率がしきい値以下へ戻ったことを示します。解析失敗が残っていないかログで確認してください。
    EOT
  }

  conditions {
    display_name = "Worker memory utilization above 90 percent"
    condition_threshold {
      filter = "metric.type = \"run.googleapis.com/container/memory/utilizations\" AND resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${google_cloud_run_v2_service.worker.name}\""

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.service_name"]
      }

      comparison              = "COMPARISON_GT"
      threshold_value         = 0.9
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    notification_prompts = ["OPENED", "CLOSED"]
  }

  notification_channels = [var.monitoring_slack_notification_channel]
  enabled               = true

  depends_on = [google_project_service.required]
}
