data "aws_iam_role" "backend_deploy" {
  name = "vorinthex-backend-deploy"
}

resource "aws_iam_role_policy" "backend_deploy_system_assets" {
  name = var.backend_deploy_system_assets_policy_name
  role = data.aws_iam_role.backend_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${module.storage.s3_bucket_arn}/apps/logos/v1/*",
          "${module.storage.s3_bucket_arn}/system/initial-audiobook/v1/*",
          "${module.storage.s3_bucket_arn}/system/initial-gallery/v1/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:PutParameter"]
        Resource = ["arn:aws:ssm:${var.aws_region}:*:parameter/${local.normalized_ssm_prefix}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:CreateRepository",
          "ecr:DescribeRepositories",
          "ecr:GetAuthorizationToken",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${module.storage.s3_bucket_arn}/managed/scope-directory/v1/*"]
      }
    ]
  })
}
