#!/bin/bash
set -e

REGION=eu-north-1
BUCKET=vorinthex-dev
QUEUE=vorinthex-file-events

awslocal sqs create-queue --queue-name "$QUEUE" --region "$REGION"

QUEUE_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://sqs.$REGION.localhost.localstack.cloud:4566/000000000000/$QUEUE" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text \
  --region "$REGION")

awslocal s3 mb "s3://$BUCKET" --region "$REGION"

awslocal s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedOrigins": ["http://localhost:3001", "http://localhost:3000"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type", "Content-Length", "Authorization"],
      "MaxAgeSeconds": 3600
    }]
  }' \
  --region "$REGION"

awslocal s3api put-bucket-notification-configuration \
  --bucket "$BUCKET" \
  --notification-configuration "{
    \"QueueConfigurations\": [{
      \"QueueArn\": \"$QUEUE_ARN\",
      \"Events\": [\"s3:ObjectCreated:*\"]
    }]
  }" \
  --region "$REGION"

echo "LocalStack initialized: bucket=$BUCKET, queue=$QUEUE"

