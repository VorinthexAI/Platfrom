resource "aws_ecr_repository" "backend" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, {
    Name = var.ecr_repository_name
  })
}

# NEW: dedicated ECR repo for the web (Next standalone) image. Additive; nothing
# references it yet, so creating it cannot affect the running backend repo.
resource "aws_ecr_repository" "web" {
  name                 = var.ecr_web_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, {
    Name = var.ecr_web_repository_name
  })
}

locals {
  # Expire untagged images quickly and cap the number of retained :sha-tagged
  # images so the registry does not grow unbounded. The most recent tags are
  # always kept, so live/rollback images are never pruned.
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the most recent ${var.ecr_keep_last_images} sha-tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha-", "sha"]
          countType     = "imageCountMoreThan"
          countNumber   = var.ecr_keep_last_images
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_s3_bucket" "runtime" {
  bucket = var.s3_bucket_name

  tags = merge(var.tags, {
    Name = var.s3_bucket_name
  })
}

resource "aws_s3_bucket_public_access_block" "runtime" {
  bucket                  = aws_s3_bucket.runtime.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "runtime" {
  bucket = aws_s3_bucket.runtime.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "runtime" {
  bucket = aws_s3_bucket.runtime.id

  versioning_configuration {
    status = "Enabled"
  }
}

# NEW: cost/hygiene lifecycle on the runtime bucket. Additive configuration on
# the existing bucket — it prunes noncurrent versions and dangling multipart
# uploads but never deletes current objects, so live data is untouched.
resource "aws_s3_bucket_lifecycle_configuration" "runtime" {
  bucket = aws_s3_bucket.runtime.id

  # Versioning is enabled above; ordering the config after it avoids a
  # "versioning must be enabled" race on first apply.
  depends_on = [aws_s3_bucket_versioning.runtime]

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.s3_noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
