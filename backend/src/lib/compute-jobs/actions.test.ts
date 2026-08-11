import { afterEach, describe, expect, test } from 'bun:test';
import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { COMPUTE_ACTIONS, computeDispatch, computeDispatchConfigured } from './actions';

const keys = ['COMPUTE_ECS_CLUSTER', 'COMPUTE_ECS_TASK_DEFINITION', 'COMPUTE_ECS_SUBNETS', 'COMPUTE_ECS_SECURITY_GROUPS'] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('compute-dispatch action', () => {
  test('is registered and activates only with complete infrastructure configuration', () => {
    expect(COMPUTE_ACTIONS['compute-dispatch']).toBe(computeDispatch);
    for (const key of keys) delete process.env[key];
    expect(computeDispatchConfigured()).toBe(false);
    for (const key of keys) process.env[key] = key;
    expect(computeDispatchConfigured()).toBe(true);
  });

  test('launches one isolated registered Fargate command', async () => {
    process.env.COMPUTE_ECS_CLUSTER = 'cluster';
    process.env.COMPUTE_ECS_TASK_DEFINITION = 'task-definition';
    process.env.COMPUTE_ECS_SUBNETS = 'subnet-a,subnet-b';
    process.env.COMPUTE_ECS_SECURITY_GROUPS = 'sg-worker';
    let command: RunTaskCommand | undefined;
    const result = await computeDispatch({ jobType: 'document-processing', jobKey: 'a'.repeat(64) }, {
      ecs: { async send(value) { command = value; return { tasks: [{ taskArn: 'task-arn' }], $metadata: {} }; } },
    });
    expect(result).toEqual({ taskArn: 'task-arn' });
    expect(command?.input).toMatchObject({
      cluster: 'cluster', taskDefinition: 'task-definition', launchType: 'FARGATE', count: 1,
      networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-a', 'subnet-b'], securityGroups: ['sg-worker'], assignPublicIp: 'ENABLED' } },
      overrides: { containerOverrides: [{ name: 'document-worker', command: ['src/document-worker/index.ts'], environment: [{ name: 'DOCUMENT_PROCESSING_JOB_ID', value: 'a'.repeat(64) }] }] },
    });
    await computeDispatch({ jobType: 'image-hashing', jobKey: 'b'.repeat(64) }, {
      ecs: { async send(value) { command = value; return { tasks: [{ taskArn: 'image-task-arn' }], $metadata: {} }; } },
    });
    expect(command?.input.overrides).toEqual({ containerOverrides: [{ name: 'document-worker', command: ['src/image-worker/index.ts'], environment: [{ name: 'IMAGE_HASHING_JOB_ID', value: 'b'.repeat(64) }] }] });
  });

  test('rejects unregistered job types and arbitrary keys', async () => {
    await expect(computeDispatch({ jobType: 'arbitrary', jobKey: 'safe' } as never)).rejects.toThrow();
    await expect(computeDispatch({ jobType: 'document-processing', jobKey: '../unsafe' })).rejects.toThrow();
  });
});
