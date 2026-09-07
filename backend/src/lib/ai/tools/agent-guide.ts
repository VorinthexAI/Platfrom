import { z } from 'zod';
import { appsService, type AppsService } from '@/lib/apps/service';
import { appDetailedDescriptionSchema, appSlugSchema } from '@/lib/apps/registry';

export const agentGuideInputSchema = z.object({
  mode: z.enum(['recommend', 'explain']),
}).strict();

export const agentGuideOutputSchema = z.object({
  mode: z.enum(['recommend', 'explain']),
  apps: z.array(z.object({
    slug: appSlugSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(300),
    detailedDescription: appDetailedDescriptionSchema,
  }).strict()).max(20),
}).strict();

export function createAgentGuideTool(service: Pick<AppsService, 'list'> = appsService) {
  return {
    name: 'agent.guide',
    inputSchema: agentGuideInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'agent.guide',
      description: 'Read the canonical Vorinthex app catalog and detailed feature guidance. Use mode recommend when the user describes a goal, problem, or desired outcome and needs to know which app or capability fits; recommend only from returned facts and explain why the smallest relevant set fits. Use mode explain when the user asks what Vorinthex, Core, or a specific app does, which features it has, or how it can be used. The result includes every current app so resolve the relevant entries from the user request. Do not use this for finding user-owned workspace resources; use app.search for those.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['recommend', 'explain'] },
        },
        required: ['mode'],
      },
    },
    async execute(rawInput: unknown) {
      const input = agentGuideInputSchema.parse(rawInput);
      const apps = await service.list();
      return agentGuideOutputSchema.parse({
        mode: input.mode,
        apps: apps.map(({ slug, name, description, detailedDescription }) => ({ slug, name, description, detailedDescription })),
      });
    },
  } as const;
}

export const agentGuideToolDefinition = createAgentGuideTool();
