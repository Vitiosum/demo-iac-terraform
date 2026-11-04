# Production: may grow from nano to XS, starts with one instance.

terraform {
  required_version = ">= 1.11"

  required_providers {
    clevercloud = {
      source  = "CleverCloud/clevercloud"
      version = "~> 3.0"
    }
  }

  # The state lives in the Cellar bucket created by infra/bootstrap, one key
  # per environment. Bucket, endpoint and keys come from the file the
  # bootstrap writes: terraform init -backend-config=../cellar.s3.tfbackend
  # The key stays at the root of the bucket: provider 3.0.0 empties a bucket
  # without looking into folders, so "production/x" would block the bootstrap destroy.
  backend "s3" {
    key          = "production.tfstate"
    use_lockfile = true

    # Cellar speaks S3: these settings turn off what only AWS has.
    region                      = "us-east-1"
    use_path_style              = true
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
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
