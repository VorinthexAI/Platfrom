# ============================================================================
# edge: CloudFront distribution in front of the web ALB, plus the us-east-1
# ACM certificate CloudFront requires. Fully additive — it fronts the ALB and
# touches no existing resource. Static paths (_next/static, /public) are cached;
# /api/* is forwarded with no caching, no buffering, and all headers/cookies +
# Host preserved for proxy.ts hostname routing and SSE pass-through.
#
# Requires an aws provider aliased to us-east-1 (CloudFront/ACM constraint).
# ============================================================================

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

locals {
  create_acm  = var.viewer_acm_certificate_arn == "" && length(var.web_domain_names) > 0
  has_aliases = var.viewer_acm_certificate_arn != "" && length(var.web_domain_names) > 0
  aliases     = local.has_aliases ? distinct(concat(var.web_domain_names, var.api_domain_names)) : []
  origin_id   = "${var.name_prefix}-alb-origin"

  # AWS managed policies (well-known IDs).
  cache_optimized_id      = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  cache_disabled_id       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  origin_all_viewer_id    = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer (forwards Host + all headers/cookies/qs)
  response_sec_headers_id = "67f7725c-6f97-4210-82d7-5512b31e9d03" # SecurityHeadersPolicy
}

# Custom cache policy for the default (HTML) behavior. The web app serves every
# domain from one origin via proxy.ts hostname routing, so the SAME path (e.g.
# "/") returns different HTML per Host. Managed CachingOptimized omits Host from
# the cache key, which would let one domain's page be served to another. This
# policy puts Host in the cache key so each domain caches its own HTML, while
# still caching at the edge (fast globally, Vercel-like). Query strings are
# ignored (the galaxy app reads them client-side) for a high cache-hit rate;
# min_ttl=0 lets dynamic/SSR routes opt out via their Cache-Control: no-cache.
resource "aws_cloudfront_cache_policy" "html" {
  name    = "${var.name_prefix}-html-per-host"
  comment = "Default/HTML behavior: Host in the cache key for proxy.ts multi-domain routing"

  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Host"]
      }
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# us-east-1 ACM cert for the CloudFront viewer certificate (DNS validation via
# Cloudflare; outputs only). Created PENDING_VALIDATION, does not block apply.
resource "aws_acm_certificate" "cloudfront" {
  provider                  = aws.us_east_1
  count                     = local.create_acm ? 1 : 0
  domain_name               = var.web_domain_names[0]
  subject_alternative_names = distinct(concat(slice(var.web_domain_names, 1, length(var.web_domain_names)), var.api_domain_names))
  validation_method         = "DNS"

  tags = merge(var.tags, { Name = "${var.name_prefix}-cloudfront-cert" })

  lifecycle {
    create_before_destroy = true
  }
}

# ----------------------------------------------------------------------------
# AWS WAFv2 web ACL (CLOUDFRONT scope, so it MUST live in us-east-1). Additive:
# it is created alongside the distribution and attached via the distribution's
# web_acl_id attribute (an in-place update — CloudFront is never replaced).
#
# Rules, in priority order:
#   1. AWSManagedRulesCommonRuleSet        (OWASP-style core protections)
#   2. AWSManagedRulesKnownBadInputsRuleSet (known exploit / bad-input patterns)
#   3. AWSManagedRulesAmazonIpReputationList (AWS threat-intel IP reputation)
#  10. Rate-based per-IP limit (default 2000 requests / 5 min → block)
#
# Managed groups use override_action { none {} } so each group's own block/count
# actions apply. Everything not matched falls through to the default allow.
# ----------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "this" {
  provider    = aws.us_east_1
  count       = var.waf_enabled ? 1 : 0
  name        = "${var.name_prefix}-cloudfront-waf"
  description = "${var.name_prefix} CloudFront WAF: AWS managed rule groups + per-IP rate limit."
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-waf-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-waf-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-waf-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Per-IP rate limit. aggregate over a 5-minute (300s) window and block IPs
  # exceeding var.waf_rate_limit requests within it.
  rule {
    name     = "RateLimitPerIP"
    priority = 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-waf-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-cloudfront-waf"
    sampled_requests_enabled   = true
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-cloudfront-waf" })
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} web edge"
  price_class     = var.price_class
  aliases         = local.aliases

  # Attach the WAFv2 web ACL (ARN) when enabled. This is an in-place update on
  # the existing distribution and does NOT trigger a replacement.
  web_acl_id = var.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null

  origin {
    domain_name = var.alb_domain_name
    origin_id   = local.origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    dynamic "custom_header" {
      for_each = var.origin_custom_header_value != "" ? [1] : []
      content {
        name  = var.origin_custom_header_name
        value = var.origin_custom_header_value
      }
    }
  }

  # Default behavior -> web origin. Host is forwarded (AllViewer) so proxy.ts
  # subdomain routing works.
  default_cache_behavior {
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.html.id
    origin_request_policy_id = local.origin_all_viewer_id
  }

  # Long-lived immutable static assets.
  ordered_cache_behavior {
    path_pattern             = "/_next/static/*"
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_optimized_id
    origin_request_policy_id = local.origin_all_viewer_id
  }

  # api / SSE: no caching, all methods, forward everything incl. Host + cookies.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = false
    cache_policy_id          = local.cache_disabled_id
    origin_request_policy_id = local.origin_all_viewer_id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.viewer_acm_certificate_arn == ""
    acm_certificate_arn            = var.viewer_acm_certificate_arn != "" ? var.viewer_acm_certificate_arn : null
    ssl_support_method             = var.viewer_acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.viewer_acm_certificate_arn != "" ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-cloudfront" })
}
