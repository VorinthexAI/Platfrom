data "aws_iam_role" "backend_deploy" {
  name = "vorinthex-backend-deploy"
}

resource "aws_iam_role_policy" "backend_deploy_system_assets" {
  name = "vorinthex-backend-deploy-system-assets"
  role = data.aws_iam_role.backend_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${module.storage.s3_bucket_arn}/apps/logos/v1/*",
          "${module.storage.s3_bucket_arn}/system/initial-audiobook/v1/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${module.storage.s3_bucket_arn}/managed/scope-directory/v1/*"]
      }
    ]
  })
}
