export interface DispatchFargateRenderInput {
  cluster: string;
  taskDefinition: string;
  subnetIds: string[];
  securityGroupIds: string[];
}

export async function dispatchFargateRender(input: DispatchFargateRenderInput) {
  if (!process.env.AWS_REGION) {
    return { status: 'ready_to_execute', reason: 'AWS credentials/region are not configured.' };
  }
  return {
    status: 'ready_to_execute',
    cluster: input.cluster,
    taskDefinition: input.taskDefinition,
    capacityProviderStrategy: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }],
  };
}

