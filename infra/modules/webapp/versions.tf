terraform {
  required_version = ">= 1.9"

  required_providers {
    clevercloud = {
      source  = "CleverCloud/clevercloud"
      version = "~> 3.0"
    }
  }
}
