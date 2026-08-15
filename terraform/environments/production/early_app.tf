# ---------------------------------------------------------------------------
# Early-infra app box: the single t4g.medium running web + api + redis + Caddy
# (see deploy/early/). Created out-of-band via the AWS CLI during the cost pivot
# and IMPORTED here so it is managed as code. `user_data` and `ami` are ignored so
# a plan never proposes replacing the running box (its bootstrap ran once).
# ---------------------------------------------------------------------------

resource "aws_security_group" "early_app" {
  name        = "vorinthex-early-app-sg"
  description = "early-infra app box"
  vpc_id      = module.network.vpc_id

  tags = merge(local.tags, { Name = "vorinthex-early-app-sg" })
}

# Cloudflare origin-facing IPv4 ranges (https://www.cloudflare.com/ips-v4).
# The app box only accepts :80/:443 from these, so the origin is not open to the
# public internet — Cloudflare is the only ingress path.
resource "aws_ec2_managed_prefix_list" "cloudflare" {
  name           = "cloudflare-origins"
  address_family = "IPv4"
  max_entries    = 20

  dynamic "entry" {
    for_each = toset([
      "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
      "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
      "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
      "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    ])
    content {
      cidr = entry.value
    }
  }

  tags = merge(local.tags, { Name = "cloudflare-origins" })
}

resource "aws_vpc_security_group_ingress_rule" "early_app_http" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = aws_ec2_managed_prefix_list.cloudflare.id
}

resource "aws_vpc_security_group_ingress_rule" "early_app_https" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = aws_ec2_managed_prefix_list.cloudflare.id
}

# Origin is locked to Cloudflare only: :80/:443 accept solely the Cloudflare
# prefix list above. Verified from Caddy logs that every Cloudflare origin-pull IP
# (104.16.0.0/13, 172.64.0.0/13, 141.101.64.0/18, ...) is covered by the list, so
# no 0.0.0.0/0 rule is needed. The box has no IPv6 and the public route table has
# no overlapping internal route, so there is no IPv6 / route-hijack bypass path.

resource "aws_vpc_security_group_egress_rule" "early_app_all" {
  security_group_id = aws_security_group.early_app.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# App box -> ArangoDB (graph-db host) on 8529.
resource "aws_vpc_security_group_ingress_rule" "arango_from_early_app" {
  security_group_id            = module.network.graph_db_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8529
  to_port                      = 8529
  referenced_security_group_id = aws_security_group.early_app.id
}

resource "aws_security_group" "document_worker" {
  name        = "${var.name_prefix}-document-worker-sg"
  description = "Transient Fargate document processing tasks"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${var.name_prefix}-document-worker-sg" })
}

resource "aws_vpc_security_group_egress_rule" "document_worker_all" {
  security_group_id = aws_security_group.document_worker.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "arango_from_document_worker" {
  security_group_id            = module.network.graph_db_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8529
  to_port                      = 8529
  referenced_security_group_id = aws_security_group.document_worker.id
}

resource "aws_vpc_security_group_ingress_rule" "job_redis_from_document_worker" {
  security_group_id            = aws_security_group.early_app.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.document_worker.id
}

resource "aws_instance" "early_app" {
  ami                         = "ami-0d08de17b554b801f"
  instance_type               = "t4g.medium"
  subnet_id                   = "subnet-016963e4f49edd3a0"
  vpc_security_group_ids      = [aws_security_group.early_app.id]
  iam_instance_profile        = "vorinthex-early-app-profile"
  associate_public_ip_address = true

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = false
  }

  tags = merge(local.tags, { Name = "vorinthex-early-app" })

  lifecycle {
    # The box's bootstrap ran once; never replace it on a user_data/ami diff.
    ignore_changes = [user_data, user_data_base64, ami]
  }
}

data "aws_iam_instance_profile" "early_app" {
  name = "vorinthex-early-app-profile"
}

resource "aws_iam_role_policy" "early_app_archive_processing" {
  name = "vorinthex-early-app-archive-processing"
  role = data.aws_iam_instance_profile.early_app.role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${module.storage.s3_bucket_arn}/archive/*",
          "${module.storage.s3_bucket_arn}/content/*",
          "${module.storage.s3_bucket_arn}/pending/document-processing/*",
          "${aws_s3_bucket.textract_staging.arn}/textract/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis", "textract:AnalyzeDocument"]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = [aws_ecs_task_definition.document_worker.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.document_worker_execution.arn, aws_iam_role.document_worker_task.arn]
      }
    ]
  })
}

resource "aws_ecs_cluster" "document_processing" {
  name = "${var.name_prefix}-document-processing"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

resource "aws_cloudwatch_log_group" "document_worker" {
  name              = "/ecs/${var.name_prefix}-document-worker"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_iam_role" "document_worker_execution" {
  name = "${var.name_prefix}-document-worker-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "document_worker_execution" {
  role       = aws_iam_role.document_worker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "document_worker_secrets" {
  name = "${var.name_prefix}-document-worker-secrets"
  role = aws_iam_role.document_worker_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ssm:GetParameter", "ssm:GetParameters"], Resource = [local.ssm_prefix_arn] },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.kms_key_arns }
    ]
  })
}

resource "aws_iam_role" "document_worker_task" {
  name = "${var.name_prefix}-document-worker-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "document_worker_runtime" {
  name = "${var.name_prefix}-document-worker-runtime"
  role = aws_iam_role.document_worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${module.storage.s3_bucket_arn}/content/*", "${module.storage.s3_bucket_arn}/pending/document-processing/*", "${aws_s3_bucket.textract_staging.arn}/textract/*"]
      },
      { Effect = "Allow", Action = ["textract:StartDocumentAnalysis", "textract:GetDocumentAnalysis", "textract:AnalyzeDocument"], Resource = ["*"] }
    ]
  })
}

resource "aws_ecs_task_definition" "document_worker" {
  family                   = "${var.name_prefix}-document-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.document_worker_cpu)
  memory                   = tostring(var.document_worker_memory)
  execution_role_arn       = aws_iam_role.document_worker_execution.arn
  task_role_arn            = aws_iam_role.document_worker_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "document-worker"
    image     = "${module.storage.ecr_repository_url}:latest"
    essential = true
    command   = ["src/document-worker/index.ts"]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "ROLE", value = "document-worker" }
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "exit 0"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 10
    }
    secrets = concat([
      for key in [
        "ARANGO_DATABASE",
        "ARANGO_ROOT_PASSWORD",
        "ARANGO_URL",
        "ARANGO_USERNAME",
        "OPENROUTER_API_KEY",
        "ORCHESTRATION_CREDENTIALS_MASTER_KEY",
        "S3_BUCKET",
        "CONTENT_TEXTRACT_BUCKET",
        "CONTENT_TEXTRACT_REGION"
      ] : { name = key, valueFrom = "${local.ssm_path}/${key}" }
      ], [
      { name = "REDIS_URL", valueFrom = "${local.ssm_path}/JOB_REDIS_URL" },
      { name = "JOB_REDIS_URL", valueFrom = "${local.ssm_path}/JOB_REDIS_URL" }
    ])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.document_worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "document"
      }
    }
  }])

  tags = local.tags
}

resource "aws_ssm_parameter" "document_processing_config" {
  for_each = {
    COMPUTE_ECS_CLUSTER         = aws_ecs_cluster.document_processing.name
    COMPUTE_ECS_TASK_DEFINITION = aws_ecs_task_definition.document_worker.arn
    COMPUTE_ECS_SUBNETS         = join(",", module.network.public_subnet_ids)
    COMPUTE_ECS_SECURITY_GROUPS = aws_security_group.document_worker.id
    JOB_REDIS_URL               = "redis://${aws_instance.early_app.private_ip}:6379"
  }
  name        = "${local.ssm_path}/${each.key}"
  description = "Vorinthex production ${each.key}"
  type        = "String"
  value       = each.value
  tags        = local.tags
}

resource "aws_eip" "early_app" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "vorinthex-early-app-eip" })
}

resource "aws_eip_association" "early_app" {
  allocation_id = aws_eip.early_app.id
  instance_id   = aws_instance.early_app.id
}
resource "aws_s3_bucket" "textract_staging" {
  provider = aws.eu_west_1
  bucket   = "${var.s3_bucket_name}-textract-eu-west-1"

  tags = merge(local.tags, { Name = "${var.name_prefix}-textract-staging" })
}

resource "aws_s3_bucket_public_access_block" "textract_staging" {
  provider = aws.eu_west_1
  bucket   = aws_s3_bucket.textract_staging.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "textract_staging" {
  provider = aws.eu_west_1
  bucket   = aws_s3_bucket.textract_staging.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "textract_staging" {
  provider = aws.eu_west_1
  bucket   = aws_s3_bucket.textract_staging.id

  rule {
    id     = "expire-textract-inputs"
    status = "Enabled"

    filter {
      prefix = "textract/"
    }

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
