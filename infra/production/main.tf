# Production: may grow from nano to XS, starts with one instance.

terraform {
  required_version = ">= 1.9"

  required_providers {
    clevercloud = {
      source  = "CleverCloud/clevercloud"
      version = "~> 3.0"
    }
  }

  # The state stays local, next to this file, and is ignored by git:
  # it holds the database password.
}

# Credentials: those of `clever login`, read by the provider from clever-tools.
# Organisation: export CC_ORGANISATION=orga_xxx before running terraform.
provider "clevercloud" {}

module "webapp" {
  source = "../modules/webapp"

  environment     = "production"
  region          = "par"
  smallest_flavor = "nano"
  biggest_flavor  = "XS"
  min_instances   = 1
  max_instances   = 1
  db_plan         = "xxs_sml"
  db_version      = "18"

  repository = "file://${abspath("${path.root}/${var.repo_root}")}"
  app_folder = var.app_folder
}

variable "repo_root" {
  description = "Root of the git repository to deploy, relative to this folder."
  type        = string
  default     = "../.."
}

variable "app_folder" {
  description = "Folder of the app inside that repository."
  type        = string
  default     = "app"
}

output "url" {
  value = module.webapp.url
}

output "declared" {
  value = module.webapp.declared
}
