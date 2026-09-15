locals {
  name_prefix = "foodfolio-${var.environment}"
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudtasks.googleapis.com",
    "firebase.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
    "youtube.googleapis.com",
  ])
  secret_ids = toset([
    "foodfolio-dev-database-url",
    "foodfolio-dev-database-direct-url",
    "foodfolio-dev-gemini-api-key",
    "foodfolio-dev-openai-api-key",
    "foodfolio-dev-zai-api-key",
    "foodfolio-dev-youtube-api-key",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "foodfolio"
  description   = "Foodfolio application containers"
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_ids
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_service_account" "api" {
  account_id   = "${local.name_prefix}-api"
  display_name = "Foodfolio dev API"
}

resource "google_service_account" "worker" {
  account_id   = "${local.name_prefix}-worker"
  display_name = "Foodfolio dev Worker"
}

resource "google_service_account" "task_invoker" {
  account_id   = "${local.name_prefix}-task-invoker"
  display_name = "Foodfolio dev Cloud Tasks invoker"
}

resource "google_service_account" "github_deployer" {
  account_id   = "${local.name_prefix}-github"
  display_name = "Foodfolio dev GitHub deployer"
}

resource "google_storage_bucket" "tiktok_video_fallback" {
  name                        = "${var.project_id}-${var.environment}-tiktok-video-fallback"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "worker_tiktok_video_objects" {
  bucket = google_storage_bucket.tiktok_video_fallback.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_service_account_iam_member" "worker_signs_tiktok_video_urls" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket" "generated_recipe_images" {
  name                        = "${var.project_id}-${var.environment}-generated-recipe-images"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "generated_recipe_images_public_read" {
  bucket = google_storage_bucket.generated_recipe_images.name
  role   = "roles/storage.legacyObjectReader"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "worker_generated_recipe_images_objects" {
  bucket = google_storage_bucket.generated_recipe_images.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "api_generated_recipe_images_objects" {
  bucket = google_storage_bucket.generated_recipe_images.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_roles" {
  for_each = toset([
    "roles/cloudtasks.enqueuer",
    "roles/firebaseauth.admin",
    "roles/secretmanager.secretAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_roles" {
  for_each = toset([
    "roles/firebasecloudmessaging.admin",
    "roles/secretmanager.secretAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "github_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/cloudtasks.admin",
    "roles/run.admin",
    "roles/secretmanager.secretAccessor",
    "roles/serviceusage.serviceUsageConsumer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "github_act_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "github_act_as_worker" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_service_account_iam_member" "api_act_as_task_invoker" {
  service_account_id = google_service_account.task_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "developer_cloud_build" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "user:kei.patheng@gmail.com"
}

resource "google_cloud_tasks_queue" "analysis" {
  name     = "${local.name_prefix}-recipe-analysis"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 2
    max_dispatches_per_second = 1
  }
  retry_config {
    max_attempts       = 3
    max_retry_duration = "900s"
    min_backoff        = "5s"
    max_backoff        = "60s"
    max_doublings      = 3
  }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "${local.name_prefix}-worker"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.worker.email
    timeout         = "600s"
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image   = var.worker_image
      command = ["node"]
      args    = ["dist/src/entrypoints/worker.js"]
      ports { container_port = 8080 }
      resources { limits = { cpu = "1", memory = "512Mi" } }
      env {
        name  = "APP_ENV"
        value = var.environment
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "MAX_ANALYSIS_ATTEMPTS"
        value = "3"
      }
      env {
        name  = "AI_MODEL"
        value = "glm-5.3-flash"
      }
      env {
        name  = "OPENAI_IMAGE_MODEL"
        value = "gpt-image-2.5-flare"
      }
      env {
        name  = "GENERATED_RECIPE_IMAGE_BUCKET"
        value = google_storage_bucket.generated_recipe_images.name
      }
      env {
        name  = "TIKTOK_MEDIA_ANALYSIS_ENABLED"
        value = "true"
      }
      env {
        name  = "YOUTUBE_GEMINI_FALLBACK_ENABLED"
        value = "true"
      }
      env {
        name  = "TIKTOK_VIDEO_BUCKET"
        value = google_storage_bucket.tiktok_video_fallback.name
      }
      env {
        name  = "TIKTOK_VIDEO_MAX_ATTEMPTS"
        value = "5"
      }
      env {
        name  = "INSTAGRAM_MEDIA_FALLBACK_ENABLED"
        value = "true"
      }
      env {
        name  = "INSTAGRAM_MEDIA_BUCKET"
        value = google_storage_bucket.tiktok_video_fallback.name
      }
      env {
        name  = "INSTAGRAM_MEDIA_MAX_ATTEMPTS"
        value = "5"
      }
      env {
        name  = "YT_DLP_PATH"
        value = "/usr/local/bin/yt-dlp"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-database-url"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ZAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-zai-api-key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-openai-api-key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-gemini-api-key"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "YOUTUBE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-youtube-api-key"].secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [
    google_project_service.required,
    google_project_iam_member.worker_roles,
    google_storage_bucket_iam_member.worker_tiktok_video_objects,
    google_service_account_iam_member.worker_signs_tiktok_video_urls,
    google_storage_bucket_iam_member.worker_generated_recipe_images_objects,
    google_storage_bucket_iam_member.generated_recipe_images_public_read,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "task_invokes_worker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name                = "${local.name_prefix}-api"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email
    timeout         = "60s"
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image   = var.api_image
      command = ["node"]
      args    = ["dist/src/entrypoints/api.js"]
      ports { container_port = 8080 }
      resources { limits = { cpu = "1", memory = "512Mi" } }
      env {
        name  = "APP_ENV"
        value = var.environment
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "TIKTOK_MEDIA_ANALYSIS_ENABLED"
        value = "true"
      }
      env {
        name  = "GENERATED_RECIPE_IMAGE_BUCKET"
        value = google_storage_bucket.generated_recipe_images.name
      }
      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.region
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.analysis.name
      }
      env {
        name  = "WORKER_URL"
        value = google_cloud_run_v2_service.worker.uri
      }
      env {
        name  = "TASK_INVOKER_SERVICE_ACCOUNT"
        value = google_service_account.task_invoker.email
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-database-url"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "YOUTUBE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["foodfolio-dev-youtube-api-key"].secret_id
            version = "latest"
          }
        }
      }
    }
  }
  depends_on = [
    google_project_service.required,
    google_project_iam_member.api_roles,
    google_storage_bucket_iam_member.api_generated_recipe_images_objects,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_api" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "foodfolio-github"
  display_name              = "Foodfolio GitHub Actions"
  depends_on                = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "Foodfolio repository"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository == '${var.github_repository}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "Foodfolio MVP monthly budget"
  amount {
    specified_amount {
      currency_code = "JPY"
      units         = "1000"
    }
  }
  budget_filter { projects = ["projects/${data.google_project.current.number}"] }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  depends_on = [google_project_service.required]
}

data "google_project" "current" {
  project_id = var.project_id
}
