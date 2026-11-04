output "url" {
  description = "Address of the app."
  value       = "https://${tolist(clevercloud_nodejs.app.vhosts)[0].fqdn}"
}

output "app_id" {
  description = "ID of the app (app_…)."
  value       = clevercloud_nodejs.app.id
}

output "database_id" {
  description = "ID of the PostgreSQL add-on (postgresql_…)."
  value       = clevercloud_postgresql.db.id
}

output "declared" {
  description = "Size and database as declared, readable in every plan."
  value = {
    flavor     = var.smallest_flavor == var.biggest_flavor ? var.smallest_flavor : "${var.smallest_flavor} to ${var.biggest_flavor}"
    instances  = var.min_instances == var.max_instances ? tostring(var.min_instances) : "${var.min_instances} to ${var.max_instances}"
    db_plan    = var.db_plan
    encryption = clevercloud_postgresql.db.encryption
  }
}
