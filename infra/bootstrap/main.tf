# The seed: a Cellar add-on and a bucket that keep the Terraform state of the
# environments. This folder keeps its own state locally: it cannot live in the
# bucket it creates. Apply it once, destroy it last.

terraform {
  required_version = ">= 1.11"

  required_providers {
    clevercloud = {
      source  = "CleverCloud/clevercloud"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

# Credentials: those of `clever login`. Organisation: export CC_ORGANISATION=orga_xxx.
provider "clevercloud" {}

# Bucket names are global on Cellar: a random suffix avoids collisions.
resource "random_id" "suffix" {
  byte_length = 4
}

resource "clevercloud_cellar" "state" {
  name   = "blueprint-tfstate"
  region = "par"
  tags   = ["managed-by:terraform", "demo:iac-terraform"]
}

# Destroying this bucket deletes what it holds, the states included:
# destroy the environments first.
resource "clevercloud_cellar_bucket" "state" {
  cellar_id = clevercloud_cellar.state.id
  id        = "blueprint-tfstate-${random_id.suffix.hex}"
}

# The backend settings of the environments, written by Terraform for Terraform.
# The keys go from this state to a local file (mode 0600, ignored by git):
# they are never printed, never pasted, never exported in a shell.
resource "local_sensitive_file" "backend" {
  filename        = "${path.module}/../cellar.s3.tfbackend"
  file_permission = "0600"
  content         = <<-EOT
    bucket     = "${clevercloud_cellar_bucket.state.id}"
    endpoints  = { s3 = "https://${clevercloud_cellar.state.host}" }
    access_key = "${clevercloud_cellar.state.key_id}"
    secret_key = "${clevercloud_cellar.state.key_secret}"
  EOT
}

output "bucket" {
  description = "Bucket that holds the state of each environment, one key per folder."
  value       = clevercloud_cellar_bucket.state.id
}

output "backend_config" {
  description = "File to pass to terraform init in infra/staging and infra/production."
  value       = "infra/cellar.s3.tfbackend"
}
