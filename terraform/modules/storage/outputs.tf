output "ecr_repository_name" {
  value = aws_ecr_repository.backend.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "s3_bucket_name" {
  value = aws_s3_bucket.runtime.bucket
}

output "s3_bucket_arn" {
  value = aws_s3_bucket.runtime.arn
}
