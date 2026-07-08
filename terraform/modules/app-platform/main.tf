# ============================================================================
# app-platform: additive target-state compute + edge for the stateless tiers.
#
# Everything here STANDS UP ALONGSIDE the existing app EC2 host, ArangoDB host,
# Redis, and VPC. It creates NEW security groups, a NEW ALB, a NEW ECS EC2 ASG
# and capacity provider, and NEW web/api ECS services. It never references,
# mutates, or replaces the existing stateful resources. The only touch points on
# existing infra are ADDITIVE ingress rules (api-sg -> db-sg, api-sg -> cache-sg)
# and attaching an EC2 capacity provider to the existing ECS cluster.
#
# CRITICAL: the ASG below is for web/api/render COMPUTE ONLY. The ArangoDB host
# is a separate standalone aws_instance (graph-db-host module) and is NEVER part
# of this ASG, launch template, or capacity provider.
# ============================================================================

data "aws_region" "current" {}

locals {
  ssm_path = "/${trimprefix(var.ssm_parameter_prefix, "/")}"

  web_log_group = "/ecs/${var.name_prefix}-web"
  api_log_group = "/ecs/${var.name_prefix}-api"

  # ECS-optimized Amazon Linux 2023 arm64 (Graviton) AMI for the capacity ASG.
  ecs_ami_id = data.aws_ssm_parameter.ecs_al2023_arm64.value

  create_alb_acm = var.acm_certificate_arn == "" && length(var.web_domain_names) > 0
  alb_cert_arn   = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (local.create_alb_acm ? aws_acm_certificate.alb[0].arn : "")
}

data "aws_ssm_parameter" "ecs_al2023_arm64" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id"
}

# ----------------------------------------------------------------------------
# Security groups (new, per-tier). alb-sg is public; web/api-sg only trust
# alb-sg; ecs-node-sg is the instance-level SG for the ASG hosts.
# ----------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Public ALB for web/api"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-sg" })
}

resource "aws_security_group" "web" {
  name        = "${var.name_prefix}-web-sg"
  description = "web tasks; ingress from alb-sg only"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-web-sg" })
}

resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api-sg"
  description = "api tasks; ingress from alb-sg only"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-sg" })
}

resource "aws_security_group" "ecs_node" {
  name        = "${var.name_prefix}-ecs-node-sg"
  description = "ECS EC2 capacity instances"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-node-sg" })
}

# alb-sg: allow inbound web from the internet (CloudFront/Cloudflare front it).
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count             = var.alb_https_enabled ? 1 : 0
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  ip_protocol       = "tcp"
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_all" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# web-sg / api-sg: ingress from alb-sg on the container port only.
resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.web_container_port
  ip_protocol                  = "tcp"
  to_port                      = var.web_container_port
}

resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.api_container_port
  ip_protocol                  = "tcp"
  to_port                      = var.api_container_port
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "ecs_node_all" {
  security_group_id = aws_security_group.ecs_node.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ADDITIVE ingress: give the api tier access to ArangoDB + Redis WITHOUT
# removing the existing app/render access rules on those SGs.
resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = var.db_security_group_id
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 8529
  ip_protocol                  = "tcp"
  to_port                      = 8529
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_api" {
  security_group_id            = var.cache_security_group_id
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = 6379
  ip_protocol                  = "tcp"
  to_port                      = 6379
}

# ----------------------------------------------------------------------------
# ACM certificate for the ALB (DNS validation via Cloudflare; outputs only).
# The cert is created in PENDING_VALIDATION and does not block apply. Add the
# emitted CNAME records in DNS, then set alb_https_enabled = true.
# ----------------------------------------------------------------------------

resource "aws_acm_certificate" "alb" {
  count                     = local.create_alb_acm ? 1 : 0
  domain_name               = var.web_domain_names[0]
  subject_alternative_names = distinct(concat(slice(var.web_domain_names, 1, length(var.web_domain_names)), var.api_domain_names))
  validation_method         = "DNS"

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-cert" })

  lifecycle {
    create_before_destroy = true
  }
}

# ----------------------------------------------------------------------------
# Application Load Balancer + target groups + listeners.
# ----------------------------------------------------------------------------

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.alb_subnet_ids
  idle_timeout       = var.alb_idle_timeout

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb" })
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name_prefix}-web-tg"
  port        = var.web_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.web_health_check_path
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-web-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name_prefix}-api-tg"
  port                 = var.api_container_port
  protocol             = "HTTP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = var.api_deregistration_delay

  health_check {
    path                = var.api_health_check_path
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-api-tg" })

  lifecycle {
    create_before_destroy = true
  }
}

# Port 80 listener. CloudFront/Cloudflare terminate viewer TLS and use the ALB
# as an HTTP origin, so 80 forwards (not redirects) to the web target group.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "http_api_host" {
  count        = length(var.api_domain_names) > 0 ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = var.api_domain_names
    }
  }
}

resource "aws_lb_listener_rule" "http_api_path" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# Optional HTTPS listener; only when a validated cert is available.
resource "aws_lb_listener" "https" {
  count             = var.alb_https_enabled ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.alb_ssl_policy
  certificate_arn   = local.alb_cert_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "https_api_host" {
  count        = var.alb_https_enabled && length(var.api_domain_names) > 0 ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = var.api_domain_names
    }
  }
}

resource "aws_lb_listener_rule" "https_api_path" {
  count        = var.alb_https_enabled ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}

# ----------------------------------------------------------------------------
# ECS EC2 capacity: instance role, launch template, ASG, capacity provider.
# ----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_instance" {
  name = "${var.name_prefix}-ecs-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ecs" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ssm" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ecs_instance" {
  name = "${var.name_prefix}-ecs-instance-profile"
  role = aws_iam_role.ecs_instance.name
}

resource "aws_launch_template" "ecs" {
  name_prefix   = "${var.name_prefix}-ecs-"
  image_id      = local.ecs_ami_id
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.ecs_instance.arn
  }

  vpc_security_group_ids = [aws_security_group.ecs_node.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.instance_root_volume_size
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
  }

  monitoring {
    enabled = true
  }

  user_data = base64encode(<<-USERDATA
    #!/bin/bash
    echo "ECS_CLUSTER=${var.cluster_name}" >> /etc/ecs/ecs.config
    echo "ECS_ENABLE_TASK_IAM_ROLE=true" >> /etc/ecs/ecs.config
    echo "ECS_ENABLE_SPOT_INSTANCE_DRAINING=true" >> /etc/ecs/ecs.config
  USERDATA
  )

  tag_specifications {
    resource_type = "instance"
    tags = merge(var.tags, {
      Name = "${var.name_prefix}-ecs-node"
    })
  }

  tags = var.tags
}

resource "aws_autoscaling_group" "ecs" {
  name                  = "${var.name_prefix}-ecs-asg"
  vpc_zone_identifier   = var.app_subnet_ids
  min_size              = var.asg_min_size
  max_size              = var.asg_max_size
  desired_capacity      = var.asg_desired_capacity
  protect_from_scale_in = true

  launch_template {
    id      = aws_launch_template.ecs.id
    version = "$Latest"
  }

  # Let the ECS capacity provider own desired_capacity via managed scaling.
  lifecycle {
    ignore_changes = [desired_capacity]
  }

  tag {
    key                 = "Name"
    value               = "${var.name_prefix}-ecs-node"
    propagate_at_launch = true
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = var.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_ecs_capacity_provider" "ec2" {
  name = "${var.name_prefix}-ec2-cp"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs.arn
    managed_termination_protection = "ENABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 100
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 2
    }
  }

  tags = var.tags
}

# Authoritative association for the EXISTING cluster. FARGATE + FARGATE_SPOT are
# included so the existing render service's Fargate strategy keeps working; the
# new EC2 capacity provider is added alongside them and made the default.
resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name = var.cluster_name

  capacity_providers = [
    "FARGATE",
    "FARGATE_SPOT",
    aws_ecs_capacity_provider.ec2.name,
  ]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ec2.name
    weight            = 1
    base              = 0
  }
}

# ----------------------------------------------------------------------------
# ECS roles: shared execution role (ECR pull, SSM secrets, logs) + per-service
# task roles.
# ----------------------------------------------------------------------------

resource "aws_iam_role" "execution" {
  name = "${var.name_prefix}-app-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_ssm" {
  name = "${var.name_prefix}-app-execution-ssm"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = var.ssm_parameter_arns
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arns
      }
    ]
  })
}

resource "aws_iam_role" "web_task" {
  name = "${var.name_prefix}-web-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role" "api_task" {
  name = "${var.name_prefix}-api-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "api_runtime" {
  name = "${var.name_prefix}-api-runtime"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.s3_bucket_arn, "${var.s3_bucket_arn}/*"]
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Log groups + task definitions + services.
# ----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "web" {
  name              = local.web_log_group
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.api_log_group
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name_prefix}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  cpu                      = tostring(var.web_cpu)
  memory                   = tostring(var.web_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.web_image
      essential = true
      portMappings = [{
        containerPort = var.web_container_port
        protocol      = "tcp"
      }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.web_container_port) },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "NEXT_PUBLIC_SITE_URL", value = var.site_url }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "web"
        }
      }
    }
  ])

  tags = var.tags

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image
      essential = true
      command   = ["src/api/index.ts"]
      portMappings = [{
        containerPort = var.api_container_port
        protocol      = "tcp"
      }]
      environment = [
        { name = "ROLE", value = "api" },
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.api_container_port) },
        { name = "AWS_REGION", value = data.aws_region.current.name }
      ]
      secrets = [
        for key in var.api_secret_keys : {
          name      = key
          valueFrom = "${local.ssm_path}/${key}"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])

  tags = var.tags

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "web" {
  name            = "${var.name_prefix}-web"
  cluster         = var.cluster_name
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }

  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ec2.name
    weight            = 1
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = var.web_container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  enable_execute_command             = true
  wait_for_steady_state              = false

  tags = var.tags

  depends_on = [
    aws_lb_listener.http,
    aws_ecs_cluster_capacity_providers.this,
  ]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_ecs_service" "api" {
  name            = "${var.name_prefix}-api"
  cluster         = var.cluster_name
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ec2.name
    weight            = 1
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  enable_execute_command             = true
  wait_for_steady_state              = false

  tags = var.tags

  depends_on = [
    aws_lb_listener.http,
    aws_ecs_cluster_capacity_providers.this,
  ]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ----------------------------------------------------------------------------
# Service autoscaling (web + api ONLY). Target-tracking on ALB
# RequestCountPerTarget (primary) plus CPU/memory guards.
# ----------------------------------------------------------------------------

resource "aws_appautoscaling_target" "web" {
  max_capacity       = var.web_max_count
  min_capacity       = var.web_min_count
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "web_requests" {
  name               = "${var.name_prefix}-web-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.web.arn_suffix}"
    }
    target_value       = 1000
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${var.name_prefix}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "web_memory" {
  name               = "${var.name_prefix}-web-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_count
  min_capacity       = var.api_min_count
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.name_prefix}-api-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
    target_value       = 800
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name_prefix}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${var.name_prefix}-api-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
