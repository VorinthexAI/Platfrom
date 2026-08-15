import { ECSClient, RunTaskCommand, type RunTaskCommandOutput } from '@aws-sdk/client-ecs';
import { z } from 'zod';

export const computeJobTypeSchema = z.enum(['image-hashing']);
export type ComputeJobType = z.infer<typeof computeJobTypeSchema>;

export const computeDispatchInputSchema = z.object({
  jobType: computeJobTypeSchema,
  jobKey: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

const computeDefinitions: Record<ComputeJobType, {
  containerName: string;
  command: string[];
  jobKeyEnvironmentName: string;
}> = {
  'image-hashing': {
    containerName: 'document-worker',
    command: ['src/image-worker/index.ts'],
    jobKeyEnvironmentName: 'IMAGE_HASHING_JOB_ID',
  },
};

interface EcsTaskRunner {
  send(command: RunTaskCommand): Promise<RunTaskCommandOutput>;
}

function configuredValues() {
  return {
    cluster: process.env.COMPUTE_ECS_CLUSTER?.trim(),
    taskDefinition: process.env.COMPUTE_ECS_TASK_DEFINITION?.trim(),
    subnets: process.env.COMPUTE_ECS_SUBNETS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
    securityGroups: process.env.COMPUTE_ECS_SECURITY_GROUPS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
  };
}

export function computeDispatchConfigured(): boolean {
  const config = configuredValues();
  return Boolean(config.cluster && config.taskDefinition && config.subnets.length && config.securityGroups.length);
}

/** Dispatches only registered compute jobs; callers cannot override infrastructure or commands. */
export async function computeDispatch(rawInput: z.input<typeof computeDispatchInputSchema>, options: { ecs?: EcsTaskRunner } = {}) {
  const input = computeDispatchInputSchema.parse(rawInput);
  const config = configuredValues();
  if (!config.cluster || !config.taskDefinition || !config.subnets.length || !config.securityGroups.length) {
    throw new Error('Fargate compute dispatch is not configured.');
  }
  const definition = computeDefinitions[input.jobType];
  const ecs = options.ecs ?? new ECSClient({ region: process.env.AWS_REGION ?? 'eu-north-1' });
  const response = await ecs.send(new RunTaskCommand({
    cluster: config.cluster,
    taskDefinition: config.taskDefinition,
    launchType: 'FARGATE',
    count: 1,
    platformVersion: 'LATEST',
    startedBy: `compute-${input.jobKey.slice(0, 28)}`,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: config.subnets,
        securityGroups: config.securityGroups,
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: definition.containerName,
        command: definition.command,
        environment: [{ name: definition.jobKeyEnvironmentName, value: input.jobKey }],
      }],
    },
  }));
  if (!response.tasks?.length || response.failures?.length) {
    throw new Error(`ECS could not launch the compute worker: ${response.failures?.map((failure) => failure.reason ?? failure.arn).join(', ') || 'no task returned'}`);
  }
  return { taskArn: z.string().min(1).parse(response.tasks[0]!.taskArn) };
}

export const COMPUTE_ACTIONS = {
  'compute-dispatch': computeDispatch,
} as const;
