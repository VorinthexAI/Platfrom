import { describe, expect, test } from 'bun:test';
import { CANONICAL_APPS } from '@/lib/apps/registry';
import { agentGuideInputSchema, createAgentGuideTool } from './agent-guide';

const timestamp = '2026-09-05T00:00:00.000Z';

describe('agent.guide', () => {
  test('accepts only recommend and explain modes', () => {
    expect(agentGuideInputSchema.parse({ mode: 'recommend' })).toEqual({ mode: 'recommend' });
    expect(agentGuideInputSchema.parse({ mode: 'explain' })).toEqual({ mode: 'explain' });
    expect(() => agentGuideInputSchema.parse({ mode: 'onboard' })).toThrow();
    expect(() => agentGuideInputSchema.parse({ mode: 'recommend', userKey: 'forged' })).toThrow('Unrecognized key');
  });

  test('reads every app through the canonical service and omits database metadata', async () => {
    let calls = 0;
    const apps = CANONICAL_APPS.map((app) => ({ ...app, createdAt: timestamp, updatedAt: timestamp }));
    const tool = createAgentGuideTool({ list: async () => { calls += 1; return apps; } });

    const result = await tool.execute({ mode: 'recommend' });

    expect(calls).toBe(1);
    expect(result.mode).toBe('recommend');
    expect(result.apps.map(({ slug }) => slug)).toEqual(CANONICAL_APPS.map(({ slug }) => slug));
    expect(result.apps[0]).not.toHaveProperty('key');
    expect(result.apps[0]).not.toHaveProperty('version');
    expect(result.apps[0]).not.toHaveProperty('createdAt');
    expect(result.apps[0]).not.toHaveProperty('updatedAt');
    expect(result.apps[0]).not.toHaveProperty('logoStorageKey');
    expect(result.apps[0]).not.toHaveProperty('logoUrl');
  });
});
