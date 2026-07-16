import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentRunSchema, agentOutputMetadataSchema } from './schema';
import { agentRunStepSchema } from '@/lib/ai/agent-run-steps';
import { agentRunCallSchema } from '@/lib/ai/agent-run-calls';
import { agentArtifactSchema } from '@/lib/ai/agent-artifacts';
import { agentMemorySchema, createAgentMemoryService, type AgentMemory, type AgentMemoryRepository } from '@/lib/ai/agent-memories';
import { agentRunSourceSchema } from '@/lib/ai/agent-run-sources';
import { agentArtifactCheckSchema } from '@/lib/ai/agent-artifact-checks';

const now = '2026-07-16T00:00:00.000Z';
const keys = Array.from({ length: 12 }, () => newId());

describe('split agent execution storage', () => {
  test('agentRuns contains summary fields only', () => {
    const run = agentRunSchema.parse({ key: keys[0], organizationKey: keys[1], scopeKey: keys[2], agentKey: keys[3], status: 'completed', reason: 'Task completed successfully', score: 0.9, startedAt: now, endedAt: now, elapsedMs: 0, createdAt: now });
    expect(Object.keys(run)).toEqual(['key', 'organizationKey', 'scopeKey', 'agentKey', 'principalType', 'userOrganizationKey', 'status', 'reason', 'score', 'startedAt', 'endedAt', 'elapsedMs', 'createdAt']);
    expect(run).toMatchObject({ principalType: 'system', userOrganizationKey: null });
    expect(() => agentRunSchema.parse({ ...run, steps: [] })).toThrow();
    expect(() => agentRunSchema.parse({ ...run, principalType: 'member', userOrganizationKey: null })).toThrow();
  });

  test('output metadata enforces rejection status, word limit and score range', () => {
    expect(agentOutputMetadataSchema.parse({ status: 'rejected', reason: 'Outside assigned scope', score: 0.1 }).status).toBe('rejected');
    expect(() => agentOutputMetadataSchema.parse({ status: 'accepted', reason: 'one two three four five six seven eight nine ten eleven', score: 1 })).toThrow();
    expect(() => agentOutputMetadataSchema.parse({ status: 'accepted', reason: 'ok', score: 1.1 })).toThrow();
  });

  test('steps have stable kebab-case slugs and calls validate provider token totals', () => {
    const step = agentRunStepSchema.parse({ key: keys[4], agentRunKey: keys[0], stepSlug: 'reason-about-architecture', status: 'completed', startedAt: now, endedAt: now, elapsedMs: 0 });
    expect(step.stepSlug).toBe('reason-about-architecture');
    expect(() => agentRunStepSchema.parse({ ...step, stepSlug: 'reason.about' })).toThrow();
    const call = { key: keys[5], agentRunKey: keys[0], agentRunStepKey: step.key, skillKey: keys[6], toolKey: keys[7], actionKey: keys[8], modelKey: keys[9], providerKey: keys[10], inputTokens: 4, outputTokens: 6, totalTokens: 10, startedAt: now, endedAt: now, elapsedMs: 0 };
    expect(agentRunCallSchema.parse(call).totalTokens).toBe(10);
    expect(() => agentRunCallSchema.parse({ ...call, totalTokens: 11 })).toThrow();
  });

  test('artifacts link to runs and only explicitly selected knowledge becomes memory', async () => {
    expect(agentArtifactSchema.parse({ key: keys[4], agentRunKey: keys[0], nodeType: 'image', nodeKey: keys[11], relation: 'result' }).relation).toBe('result');
    const stored: AgentMemory[] = [];
    const repository: AgentMemoryRepository = {
      async insertMemory(input) { const memory = agentMemorySchema.parse({ ...input, key: input.key ?? newId(), embedding: [], createdAt: now }); stored.push(memory); return memory; },
      async listMemoriesForAgent() { return stored; },
    };
    const service = createAgentMemoryService(repository);
    const base = { organizationKey: keys[1], scopeKey: keys[2], agentKey: keys[3], skillKey: keys[6], sourceRunKey: keys[0], content: 'Backend uses ArangoDB and Zod.', memoryType: 'fact' as const, importance: 0.8 };
    expect(await service.persistSelection({ ...base, selected: false })).toBeNull();
    expect(stored).toHaveLength(0);
    expect((await service.persistSelection({ ...base, selected: true }))?.content).toBe(base.content);
    expect(stored).toHaveLength(1);
  });

  test('source selections and novelty decisions use domain node references', () => {
    const source = agentRunSourceSchema.parse({ key: newId(), agentRunKey: keys[0], nodeType: 'blog-post', nodeKey: keys[11], priority: 100 });
    expect(Object.keys(source)).toEqual(['key', 'agentRunKey', 'nodeType', 'nodeKey', 'priority']);
    const check = agentArtifactCheckSchema.parse({ key: newId(), agentRunKey: keys[0], candidateNodeType: 'blog-post', candidateNodeKey: newId(), comparedNodeType: 'blog-post', comparedNodeKey: keys[11], similarity: 0.95, decision: 'rejected', reason: 'Too similar', createdAt: now });
    expect(check.decision).toBe('rejected');
  });
});
