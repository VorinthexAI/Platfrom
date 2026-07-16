import { z } from 'zod';

export const AGENT_ARTIFACTS_COLLECTION = 'agentArtifacts';
export const AGENT_ARTIFACT_RELATIONS = ['source', 'result', 'attachment', 'intermediate'] as const;
export const agentArtifactSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  nodeType: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  nodeKey: z.string().cuid(),
  relation: z.enum(AGENT_ARTIFACT_RELATIONS),
  groupKey: z.string().cuid().nullable().default(null),
  position: z.number().int().nonnegative().default(0),
}).strict();
export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
