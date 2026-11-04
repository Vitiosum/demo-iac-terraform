variable "name" {
  description = "Prefix of every resource name: <name>-<environment>."
  type        = string
  default     = "blueprint"
}

variable "environment" {
  description = "staging or production. Shown by the app, used in names and tags."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "Clever Cloud region of the app and its database (same region for both)."
  type        = string
  default     = "par"
}

variable "smallest_flavor" {
  description = "Smallest instance size. Equal to biggest_flavor: fixed size."
  type        = string
  default     = "nano"

  validation {
    condition     = contains(["pico", "nano", "XS", "S", "M", "L", "XL"], var.smallest_flavor)
    error_message = "smallest_flavor must be one of pico, nano, XS, S, M, L, XL."
  }
}

variable "biggest_flavor" {
  description = "Biggest instance size. Above smallest_flavor: vertical autoscaling."
  type        = string
  default     = "nano"

  validation {
    condition     = contains(["pico", "nano", "XS", "S", "M", "L", "XL"], var.biggest_flavor)
    error_message = "biggest_flavor must be one of pico, nano, XS, S, M, L, XL."
  }
}

variable "min_instances" {
  description = "Minimum number of instances."
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 1 && var.min_instances <= var.max_instances
    error_message = "min_instances must be at least 1 and not above max_instances."
  }
}

variable "max_instances" {
  description = "Maximum number of instances. Above min_instances: horizontal autoscaling."
  type        = number
  default     = 1
}

variable "db_plan" {
  description = "PostgreSQL plan. Dedicated plans only: the shared dev plan has no backups and 5 connections."
  type        = string
  default     = "xxs_sml"

  validation {
    condition     = var.db_plan != "dev"
    error_message = "The dev plan is refused: use a dedicated plan such as xxs_sml."
  }
}

variable "db_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "18"
}

variable "repository" {
  description = "Git repository Terraform deploys (its HEAD), for example file:///path/to/repo."
  type        = string
}

variable "app_folder" {
  description = "Folder of the app inside the repository (APP_FOLDER)."
  type        = string
  default     = "app"
}
