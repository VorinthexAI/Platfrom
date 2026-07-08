# Data Lifecycle Manager (DLM) automated EBS snapshots for the ArangoDB data
# volume. This is purely additive: it creates a snapshot schedule + the DLM
# service role and never touches the volume, instance, or its data. Snapshots
# are the restore point the migration/backup story depends on.

resource "aws_iam_role" "dlm" {
  name = "${var.name_prefix}-dlm-lifecycle-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "dlm.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

# AWS-managed policy scoped to exactly the snapshot/tag actions DLM needs.
resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "ebs" {
  description        = "${var.name_prefix} EBS snapshots graph-db data volume"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = var.target_volume_tags

    schedule {
      name = "daily-${var.snapshot_retain_count}-retained"

      create_rule {
        interval      = var.snapshot_interval_hours
        interval_unit = "HOURS"
        times         = [var.snapshot_time_utc]
      }

      retain_rule {
        count = var.snapshot_retain_count
      }

      tags_to_add = merge(var.tags, {
        SnapshotCreator = "dlm"
        Name            = "${var.name_prefix}-graph-db-snapshot"
      })

      copy_tags = true
    }
  }

  tags = var.tags
}
