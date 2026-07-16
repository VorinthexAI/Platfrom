import { z } from 'zod';
import { nodeTypeSchema } from '@/lib/ai/agent-run-sources';

export const AGENT_ARTIFACT_CHECKS_COLLECTION = 'agentArtifactChecks';
export const AGENT_ARTIFACT_CHECK_DECISIONS = ['accepted', 'revised', 'rejected'] as const;
export const agentArtifactCheckSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  candidateNodeType: nodeTypeSchema,
  candidateNodeKey: z.string().cuid(),
  comparedNodeType: nodeTypeSchema,
  comparedNodeKey: z.string().cuid(),
  similarity: z.number().min(-1).max(1),
  decision: z.enum(AGENT_ARTIFACT_CHECK_DECISIONS),
  reason: z.string().trim().min(1).max(1_000),
  createdAt: z.string().datetime(),
}).strict();
export type AgentArtifactCheck = z.infer<typeof agentArtifactCheckSchema>;
