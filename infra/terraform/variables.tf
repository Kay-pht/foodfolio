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
