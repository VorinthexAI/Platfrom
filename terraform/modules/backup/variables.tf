variable "name_prefix" {
  type        = string
  description = "Prefix used for backup resources."
}

variable "target_volume_tags" {
  type        = map(string)
  description = "Tag set that selects the EBS volume(s) to snapshot (e.g. the graph-db data volume)."
}

variable "snapshot_interval_hours" {
  type        = number
  description = "Hours between DLM snapshots of the target volume."
  default     = 24
}

variable "snapshot_time_utc" {
  type        = string
  description = "Daily snapshot start time in UTC (HH:MM), aligned before the DB maintenance window."
  default     = "02:00"
}

variable "snapshot_retain_count" {
  type        = number
  description = "Number of snapshots to retain per target volume."
  default     = 14
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to created resources."
  default     = {}
}
