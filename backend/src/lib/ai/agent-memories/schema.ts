import { z } from 'zod';

export const AGENT_MEMORIES_COLLECTION = 'agentMemories';
export const AGENT_MEMORY_TYPES = ['fact', 'preference', 'decision', 'instruction', 'observation', 'outcome'] as const;
export const agentMemorySchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  skillKey: z.string().cuid().nullable(),
  sourceRunKey: z.string().cuid().nullable(),
  content: z.string().trim().min(1).max(10_000),
  memoryType: z.enum(AGENT_MEMORY_TYPES),
  importance: z.number().min(0).max(1),
  embedding: z.array(z.number().finite()).default([]),
  createdAt: z.string().datetime(),
}).strict();
export type AgentMemory = z.infer<typeof agentMemorySchema>;
