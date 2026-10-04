mock_provider "google" {}

variables {
  api_image                             = "asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app:test"
  worker_image                          = "asia-southeast1-docker.pkg.dev/foodfolio-af28aa/foodfolio/app:test"
  monitoring_slack_notification_channel = "projects/foodfolio-af28aa/notificationChannels/test"
}

run "request_billing_and_dry_run_cleanup" {
  command = plan

  assert {
    condition = alltrue([
      google_cloud_run_v2_service.api.template[0].containers[0].resources[0].cpu_idle,
      google_cloud_run_v2_service.worker.template[0].containers[0].resources[0].cpu_idle,
    ])
    error_message = "ICR-1: Both services must explicitly use request-based billing."
  }

  assert {
    condition = alltrue([
      for service in [google_cloud_run_v2_service.api, google_cloud_run_v2_service.worker] :
      service.template[0].scaling[0].min_instance_count == 0 &&
      service.template[0].scaling[0].max_instance_count == 2 &&
      service.template[0].containers[0].resources[0].limits["cpu"] == "1" &&
      service.template[0].containers[0].resources[0].limits["memory"] == "512Mi"
    ])
    error_message = "ICR-1: Preserve zero minimum instances and existing resource/scale limits."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.api.template[0].timeout == "60s" &&
      google_cloud_run_v2_service.worker.template[0].timeout == "600s" &&
      google_cloud_run_v2_service.worker.ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" &&
      google_cloud_tasks_queue.analysis.retry_config[0].max_attempts == 3 &&
      google_cloud_tasks_queue.analysis.rate_limits[0].max_concurrent_dispatches == 2 &&
      google_monitoring_uptime_check_config.api_health.period == "60s" &&
      google_monitoring_uptime_check_config.api_health.http_check[0].path == "/health"
    )
    error_message = "ICR-1: Preserve deadlines, Worker isolation, retry/queue limits, and uptime monitoring."
  }

  assert {
    condition     = google_artifact_registry_repository.app.cleanup_policy_dry_run
    error_message = "ICR-4: Artifact cleanup must never delete images in this change."
  }

  assert {
    condition = (
      length(google_artifact_registry_repository.app.cleanup_policies) == 3 &&
      alltrue([
        for policy in google_artifact_registry_repository.app.cleanup_policies :
        policy.action == "DELETE" &&
        policy.condition[0].tag_state == "ANY" &&
        policy.condition[0].older_than == "2592000s"
        if policy.id == "delete-older-than-30-days"
      ]) &&
      contains([for policy in google_artifact_registry_repository.app.cleanup_policies : policy.id], "delete-older-than-30-days")
    )
    error_message = "ICR-4: Only versions older than 30 days may become cleanup candidates."
  }

  assert {
    condition = (
      alltrue([
        for policy in google_artifact_registry_repository.app.cleanup_policies :
        policy.action == "KEEP" &&
        policy.most_recent_versions[0].keep_count == 10 &&
        length(coalesce(policy.most_recent_versions[0].package_name_prefixes, [])) == 0
        if policy.id == "keep-latest-10-per-package"
      ]) &&
      contains([for policy in google_artifact_registry_repository.app.cleanup_policies : policy.id], "keep-latest-10-per-package")
    )
    error_message = "ICR-4: Keep the latest 10 versions of every package without a prefix restriction."
  }

  assert {
    condition = (
      alltrue([
        for policy in google_artifact_registry_repository.app.cleanup_policies :
        policy.action == "KEEP" &&
        policy.condition[0].tag_state == "TAGGED" &&
        contains(policy.condition[0].tag_prefixes, "keep-") &&
        policy.condition[0].older_than == null &&
        policy.condition[0].newer_than == null
        if policy.id == "keep-protected-images"
      ]) &&
      contains([for policy in google_artifact_registry_repository.app.cleanup_policies : policy.id], "keep-protected-images")
    )
    error_message = "ICR-4: Keep protected serving/rollback images regardless of their age."
  }
}
