# Download-only distribution for private runtime objects. The existing website
# Cloudflare proxy and direct API hostname do not route through this CDN.
resource "tls_private_key" "media_delivery" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_cloudfront_public_key" "media_delivery" {
  name        = "${var.name_prefix}-media-delivery"
  encoded_key = tls_private_key.media_delivery.public_key_pem
  comment     = "Private runtime object downloads"
}

resource "aws_cloudfront_key_group" "media_delivery" {
  name  = "${var.name_prefix}-media-delivery"
  items = [aws_cloudfront_public_key.media_delivery.id]
}

resource "aws_cloudfront_origin_access_control" "media_delivery" {
  name                              = "${var.name_prefix}-media-delivery"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_cache_policy" "media_delivery" {
  name        = "${var.name_prefix}-private-media"
  min_ttl     = 0
  default_ttl = 300
  max_ttl     = 900

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_distribution" "media_delivery" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  comment         = "Signed private runtime object downloads"

  origin {
    domain_name              = "${module.storage.s3_bucket_name}.s3.${var.aws_region}.amazonaws.com"
    origin_id                = "private-runtime-storage"
    origin_access_control_id = aws_cloudfront_origin_access_control.media_delivery.id
  }

  default_cache_behavior {
    target_origin_id       = "private-runtime-storage"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.media_delivery.id
    trusted_key_groups     = [aws_cloudfront_key_group.media_delivery.id]
    compress               = false
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
  tags = merge(local.tags, { Name = "${var.name_prefix}-media-delivery" })
}

resource "aws_s3_bucket_policy" "media_delivery" {
  bucket = module.storage.s3_bucket_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowPrivateMediaCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${module.storage.s3_bucket_arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media_delivery.arn } }
    }]
  })
}

resource "aws_iam_role_policy" "media_delivery_invalidation" {
  name = "${var.name_prefix}-media-delivery-invalidation"
  role = data.aws_iam_instance_profile.early_app.role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "cloudfront:CreateInvalidation"
      Resource = aws_cloudfront_distribution.media_delivery.arn
    }]
  })
}
