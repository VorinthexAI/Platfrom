import { afterEach, describe, expect, test } from 'bun:test';
import { documentProcessingJobId, documentWorkerConfigured } from './fargate-queue';

const keys = ['JOB_REDIS_URL', 'DOCUMENT_WORKER_ENABLED'] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('queued document processing', () => {
  test('activates only when infrastructure enables the dedicated worker and job Redis', () => {
    for (const key of keys) delete process.env[key];
    expect(documentWorkerConfigured()).toBe(false);
    process.env.JOB_REDIS_URL = 'redis://jobs';
    expect(documentWorkerConfigured()).toBe(false);
    process.env.DOCUMENT_WORKER_ENABLED = 'true';
    expect(documentWorkerConfigured()).toBe(true);
  });

  test('keeps document bytes in S3 for a permanent queue consumer', async () => {
    const source = await Bun.file(new URL('./fargate-queue.ts', import.meta.url)).text();
    expect(source).toContain('pending/document-processing/${jobId}/original.${normalized.extension}');
    expect(source).toContain('process.env.JOB_REDIS_URL?.trim()');
    expect(source).toContain("attempts: 3");
    expect(source).toContain('DOCUMENT_WORKER_CONCURRENCY');
    expect(source).toContain("process.once('SIGTERM'");
    expect(source).toContain("process.once('SIGINT'");
    expect(source).not.toContain("jobType: 'document-processing'");
    expect(source).not.toContain('DOCUMENT_PROCESSING_JOB_ID');
    expect(source).not.toContain('fileInput: normalized.fileInput');
  });

  test('deduplicates exact retries but separates conflicting payloads', () => {
    const request = {
      organizationKey: 'organization', agentKey: 'agent', authenticatedUserKey: 'user', idempotencyKey: 'upload-1',
      scopeKey: 'scope', mimeType: 'text/plain', bytes: new TextEncoder().encode('same document'),
    };
    const first = documentProcessingJobId(request);
    expect(first).toHaveLength(64);
    expect(documentProcessingJobId(request)).toBe(first);
    expect(documentProcessingJobId({ ...request, bytes: new TextEncoder().encode('different document') })).not.toBe(first);
    expect(documentProcessingJobId({ ...request, scopeKey: 'other-scope' })).not.toBe(first);
  });

  test('defines Redis, a warm document service, and transient image compute in Terraform', async () => {
    const infra = await Bun.file(new URL('../../../../../terraform/environments/production/early_app.tf', import.meta.url)).text();
    const deploy = await Bun.file(new URL('../../../../../deploy/early/deploy.sh', import.meta.url)).text();
    expect(deploy).toContain('--name job-redis');
    expect(deploy).toContain('-p 6379:6379');
    expect(infra).toContain('JOB_REDIS_URL               = "redis://${aws_instance.early_app.private_ip}:6379"');
    expect(infra).toContain('DOCUMENT_WORKER_ENABLED     = "true"');
    expect(infra).toContain('security_group_id            = aws_security_group.early_app.id');
    expect(infra).not.toContain('module.cache.redis_url');
    expect(infra).toContain('requires_compatibilities = ["FARGATE"]');
    expect(infra).toContain('resource "aws_ecs_service" "document_worker"');
    expect(infra).toContain('desired_count                      = var.document_worker_desired_count');
    expect(infra).toContain('stopTimeout = 120');
    expect(infra).toContain('Action   = ["ecs:RunTask"]');
    expect(infra).toContain('Action   = ["iam:PassRole"]');
    expect(infra).toContain('aws_security_group.document_worker.id');
    expect(infra).toContain('["src/document-worker/index.ts"]');
  });
});
