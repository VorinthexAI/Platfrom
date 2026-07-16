import { z } from 'zod';

export const AGENT_RUN_SOURCES_COLLECTION = 'agentRunSources';
export const nodeTypeSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const agentRunSourceSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  nodeType: nodeTypeSchema,
  nodeKey: z.string().cuid(),
  priority: z.number().int(),
}).strict();

export type AgentRunSource = z.infer<typeof agentRunSourceSchema>;
export const sourceSelectionSchema = agentRunSourceSchema.omit({ key: true, agentRunKey: true }).strict();
export type SourceSelection = z.infer<typeof sourceSelectionSchema>;
