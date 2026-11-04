# One environment: a Node.js app and its PostgreSQL database, linked.

locals {
  full_name = "${var.name}-${var.environment}"
  tags      = ["env:${var.environment}", "managed-by:terraform", "demo:iac-terraform"]
}

resource "clevercloud_postgresql" "db" {
  name    = "${local.full_name}-db"
  region  = var.region
  plan    = var.db_plan
  version = var.db_version

  # Policy of this module: every database is encrypted at rest, with daily backups.
  # Encryption is chosen at creation only: changing it means a new database.
  encryption = true
  backup     = true

  tags = local.tags
}

resource "clevercloud_nodejs" "app" {
  name        = local.full_name
  description = "Blueprint, ${var.environment} (managed by Terraform)"
  region      = var.region

  smallest_flavor    = var.smallest_flavor
  biggest_flavor     = var.biggest_flavor
  min_instance_count = var.min_instances
  max_instance_count = var.max_instances

  # The link: Clever Cloud injects POSTGRESQL_ADDON_* into the app.
  dependencies = [clevercloud_postgresql.db.id]

  app_folder     = var.app_folder
  redirect_https = true

  # What the app shows as "Declared". No secret here: the database
  # credentials only reach the app through the link above.
  environment = {
    CC_HEALTH_CHECK_PATH = "/health"
    IAC_ENVIRONMENT      = var.environment
    IAC_SOURCE           = "infra/${var.environment}/main.tf"
    IAC_REGION           = var.region
    IAC_SMALLEST_FLAVOR  = var.smallest_flavor
    IAC_BIGGEST_FLAVOR   = var.biggest_flavor
    IAC_MIN_INSTANCES    = tostring(var.min_instances)
    IAC_MAX_INSTANCES    = tostring(var.max_instances)
    IAC_DB_PLAN          = var.db_plan
    IAC_DB_VERSION       = var.db_version
    # Read back from the API by the provider, not copied from this file.
    IAC_DB_ENCRYPTION = tostring(clevercloud_postgresql.db.encryption)
  }

  # Terraform pushes the repository HEAD at creation, then whenever HEAD changes.
  deployment {
    repository = var.repository
  }

  tags = local.tags
}
