variable "project_id" {
  type    = string
  default = "foodfolio-af28aa"
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "api_image" {
  type = string
}

variable "worker_image" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "Kay-pht/foodfolio"
}

variable "billing_account" {
  type    = string
  default = "01C106-36E5A8-E7EA38"
}

variable "jev_general_web_non_recipe_threshold" {
  type    = number
  default = 0.80
  validation {
    condition     = var.jev_general_web_non_recipe_threshold >= 0 && var.jev_general_web_non_recipe_threshold <= 1
    error_message = "Jev general Web threshold must be between 0 and 1."
  }
}

variable "jev_youtube_recipe_threshold" {
  type    = number
  default = 0.99
  validation {
    condition     = var.jev_youtube_recipe_threshold >= 0 && var.jev_youtube_recipe_threshold <= 1
    error_message = "Jev YouTube threshold must be between 0 and 1."
  }
}

variable "jev_instagram_recipe_threshold" {
  type    = number
  default = 0.99
  validation {
    condition     = var.jev_instagram_recipe_threshold >= 0 && var.jev_instagram_recipe_threshold <= 1
    error_message = "Jev Instagram threshold must be between 0 and 1."
  }
}

variable "jev_tiktok_video_recipe_threshold" {
  type    = number
  default = 0.99
  validation {
    condition     = var.jev_tiktok_video_recipe_threshold >= 0 && var.jev_tiktok_video_recipe_threshold <= 1
    error_message = "Jev TikTok video threshold must be between 0 and 1."
  }
}

variable "jev_tiktok_photo_recipe_threshold" {
  type    = number
  default = 0.99
  validation {
    condition     = var.jev_tiktok_photo_recipe_threshold >= 0 && var.jev_tiktok_photo_recipe_threshold <= 1
    error_message = "Jev TikTok photo threshold must be between 0 and 1."
  }
}

variable "jev_ai_chat_non_recipe_threshold" {
  type    = number
  default = 0.99
  validation {
    condition     = var.jev_ai_chat_non_recipe_threshold >= 0 && var.jev_ai_chat_non_recipe_threshold <= 1
    error_message = "Jev AI chat threshold must be between 0 and 1."
  }
}
