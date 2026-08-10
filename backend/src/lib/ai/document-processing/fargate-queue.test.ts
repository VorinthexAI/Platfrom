import { afterEach, describe, expect, test } from 'bun:test';
import { documentFargateConfigured, documentProcessingJobId } from './fargate-queue';

const keys = [
  'COMPUTE_ECS_CLUSTER',
  'COMPUTE_ECS_TASK_DEFINITION',
  'COMPUTE_ECS_SUBNETS',
  'COMPUTE_ECS_SECURITY_GROUPS',
  'JOB_REDIS_URL',
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Fargate document processing', () => {
  test('activates only when every ECS network setting is present', () => {
    for (const key of keys) delete process.env[key];
    expect(documentFargateConfigured()).toBe(false);
    for (const key of keys) process.env[key] = key;
    expect(documentFargateConfigured()).toBe(true);
    delete process.env.COMPUTE_ECS_SUBNETS;
    expect(documentFargateConfigured()).toBe(false);
  });

  test('keeps document bytes in S3 and launches one transient Fargate task', async () => {
    const source = await Bun.file(new URL('./fargate-queue.ts', import.meta.url)).text();
    expect(source).toContain('pending/document-processing/${jobId}/original.${normalized.extension}');
    expect(source).toContain("computeDispatch({ jobType: 'document-processing', jobKey: jobId })");
    expect(source).toContain('process.env.JOB_REDIS_URL ?? process.env.REDIS_URL');
    expect(source).toContain("attempts: 3");
    expect(source).toContain('await worker.pause(true)');
    expect(source).toContain('ACTIVE_STALE_MS');
    expect(source).toContain('WAITING_RELAUNCH_SECONDS');
    expect(source).toContain("del(`document-processing:launch:${job.id}`)");
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

  test('defines Redis, task isolation, least-privilege launch, and worker cleanup in Terraform', async () => {
    const infra = await Bun.file(new URL('../../../../../terraform/environments/production/early_app.tf', import.meta.url)).text();
    const deploy = await Bun.file(new URL('../../../../../deploy/early/deploy.sh', import.meta.url)).text();
    expect(deploy).toContain('--name job-redis');
    expect(deploy).toContain('-p 6379:6379');
    expect(infra).toContain('JOB_REDIS_URL               = "redis://${aws_instance.early_app.private_ip}:6379"');
    expect(infra).toContain('security_group_id            = aws_security_group.early_app.id');
    expect(infra).not.toContain('module.cache.redis_url');
    expect(infra).toContain('requires_compatibilities = ["FARGATE"]');
    expect(infra).toContain('Action   = ["ecs:RunTask"]');
    expect(infra).toContain('Action   = ["iam:PassRole"]');
    expect(infra).toContain('aws_security_group.document_worker.id');
    expect(infra).toContain('command   = ["src/document-worker/index.ts"]');
  });
});
