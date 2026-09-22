locals {
  api_uptime_host = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
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
    mime_type = "text/markdown"
    content   = <<-EOT
      The public Foodfolio API health check has failed from at least two checker locations for 60 seconds.

      - Project: `${var.project_id}`
      - Cloud Run service: `${google_cloud_run_v2_service.api.name}`
      - Endpoint: `GET /health`
      - Monitoring: https://console.cloud.google.com/monitoring/alerting?project=${var.project_id}
      - Cloud Run: https://console.cloud.google.com/run?project=${var.project_id}
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
    mime_type = "text/markdown"
    content   = <<-EOT
      The Foodfolio API returned at least three 5xx responses in a five-minute aggregation window.

      - Project: `${var.project_id}`
      - Cloud Run service: `${google_cloud_run_v2_service.api.name}`
      - Threshold: `>= 3` 5xx responses in 5 minutes
      - Logs Explorer: https://console.cloud.google.com/logs/query?project=${var.project_id}
      - Cloud Run: https://console.cloud.google.com/run?project=${var.project_id}
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
        group_by_fields      = ["resource.label.service_name"]
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
    mime_type = "text/markdown"
    content   = <<-EOT
      A Recipe Analysis job reached its final failed state. Retry-state `analysisStatus=pending` logs do not match this policy.

      - Project: `${var.project_id}`
      - Cloud Run service: `${google_cloud_run_v2_service.worker.name}`
      - Match: `jsonPayload.analysisStatus="failed"`
      - Inspect `errorCode`, `provider`, and `analysisAttempt` in Worker logs.
      - Logs Explorer: https://console.cloud.google.com/logs/query?project=${var.project_id}
      - Cloud Run: https://console.cloud.google.com/run?project=${var.project_id}
    EOT
  }

  conditions {
    display_name = "Recipe Analysis final failure log"
    condition_matched_log {
      filter = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${google_cloud_run_v2_service.worker.name}\" AND jsonPayload.analysisStatus = \"failed\""
    }
  }

  alert_strategy {
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
    mime_type = "text/markdown"
    content   = <<-EOT
      The Foodfolio API container memory utilization p99 has remained above 90% for five minutes.

      - Project: `${var.project_id}`
      - Cloud Run service: `${google_cloud_run_v2_service.api.name}`
      - Threshold: `> 90%` for 5 minutes
      - Cloud Run: https://console.cloud.google.com/run?project=${var.project_id}
      - Monitoring: https://console.cloud.google.com/monitoring/alerting?project=${var.project_id}
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
    mime_type = "text/markdown"
    content   = <<-EOT
      The Foodfolio Worker container memory utilization p99 has remained above 90% for five minutes.

      - Project: `${var.project_id}`
      - Cloud Run service: `${google_cloud_run_v2_service.worker.name}`
      - Threshold: `> 90%` for 5 minutes
      - Cloud Run: https://console.cloud.google.com/run?project=${var.project_id}
      - Monitoring: https://console.cloud.google.com/monitoring/alerting?project=${var.project_id}
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
