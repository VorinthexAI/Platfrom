import { z } from 'zod';

export const AGENT_ARTIFACTS_COLLECTION = 'agentArtifacts';
export const AGENT_ARTIFACT_RELATIONS = ['result', 'attachment', 'source', 'intermediate'] as const;
export const agentArtifactSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  artifactKey: z.string().cuid(),
  relation: z.enum(AGENT_ARTIFACT_RELATIONS),
}).strict();
export type AgentArtifact = z.infer<typeof agentArtifactSchema>;
