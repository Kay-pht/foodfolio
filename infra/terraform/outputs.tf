output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "worker_url" { value = google_cloud_run_v2_service.worker.uri }
output "artifact_repository" { value = google_artifact_registry_repository.app.name }
output "github_service_account" { value = google_service_account.github_deployer.email }
output "workload_identity_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "task_queue" { value = google_cloud_tasks_queue.analysis.name }
