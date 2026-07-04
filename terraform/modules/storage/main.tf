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
