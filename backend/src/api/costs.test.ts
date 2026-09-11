import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { CostService } from '@/lib/costs/service';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import { createListCostsHandler } from './costs';

const schedule = {
  capabilityCosts: { 'profile.badge.generate': { sparkCost: '10', microSparkCost: 10_000_000, unit: 'invocation' as const } },
  charges: [
    { key: 'document.parse', kind: 'static' as const, name: 'Parse a document', description: 'Extract readable content.', sparkCost: '2', unit: 'documents' as const },
    { key: 'storage', kind: 'storage' as const, name: 'Storage', description: 'Charged hourly.', sparkCost: '30', unit: 'gb-month' as const },
    { key: 'ai-usage', kind: 'variable' as const, name: 'AI actions', description: 'Consumes Sparks based on usage.' },
  ],
};

describe('cost HTTP transport', () => {
  test('serves only Spark debits with public cache headers', async () => {
    const app = new Hono();
    app.get('/costs', createListCostsHandler({ listCharges: async () => schedule }));
    const response = await app.request('/costs');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    const body = await response.json();
    expect(body.data).toEqual(schedule);
    expect(JSON.stringify(body)).not.toMatch(/grant|productId|priceCents/);
  });

  test('HTTP and Core adapters call the same canonical service', async () => {
    let calls = 0;
    const costs: CostService = { listCharges: async () => { calls += 1; return schedule; } };
    const app = new Hono();
    app.get('/costs', createListCostsHandler(costs));
    expect((await app.request('/costs')).status).toBe(200);
    const userKey = newId(); const teamKey = newId();
    const domain = { teamKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'pricing.read')!;
    expect(capability.executionEffect).toBe('read');
    expect(await capability.execute({}, { domain, costs })).toMatchObject({ kind: 'continue', result: schedule });
    await expect(capability.execute({ unexpected: true }, { domain, costs })).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
