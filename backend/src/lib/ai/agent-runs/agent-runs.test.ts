import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { aggregateAgentRun } from './aggregation';
import { ensureAgentRunsCollection } from './indexes';
import { createAgentRunRepository } from './repository';
import { agentRunSchema } from './schema';
import type { AgentRunsDatabase, AgentRunsSetupDatabase } from './types';

const keys = { organization: newId(), scope: newId(), agent: newId(), skill: newId(), action: newId(), model: newId(), provider: newId() };
const startedAt = '2026-07-16T20:10:00.000Z';
const endedAt = '2026-07-16T20:10:04.000Z';

function validInsert() {
  return aggregateAgentRun({
    organizationKey: keys.organization,
    scopeKey: keys.scope,
    agentKey: keys.agent,
    status: 'accepted',
    reason: 'Request matches engineering scope',
    score: 0.94,
    startedAt,
    endedAt,
    elapsedMs: 4000,
    steps: [{ stepId: 'analyze', status: 'completed', skillKeys: [keys.skill], startedAt, endedAt, elapsedMs: 4000 }],
    calls: [{ callId: newId(), stepId: 'analyze', skillKey: keys.skill, toolKey: null, actionKey: keys.action, modelKey: keys.model, providerKey: keys.provider, inputTokens: 12, outputTokens: 34, totalTokens: 46, startedAt, endedAt, elapsedMs: 4000 }],
  });
}

function createFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const fake: AgentRunsDatabase = {
    async query(_query, bindVars = {}) {
      const rows = [...docs.values()].filter((doc) => doc.organizationKey === bindVars.organizationKey);
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection() {
      return {
        async save(doc) { docs.set(String(doc._key), doc); return { new: doc }; },
        async document(key) {
          const doc = docs.get(key);
          if (!doc) throw Object.assign(new Error('not found'), { errorNum: 1202 });
          return doc;
        },
      };
    },
  };
  return fake;
}

describe('agent run schema', () => {
  test('validates call, step, and run aggregates', () => {
    const run = agentRunSchema.parse({ ...validInsert(), key: newId(), createdAt: endedAt, _key: 'ignored' });
    expect(run.totalTokens).toBe(46);
    expect(run.steps[0]?.callIds).toEqual([run.calls[0]?.callId]);
    expect(run.skillKeys).toEqual([keys.skill]);
    expect((run as Record<string, unknown>)._key).toBeUndefined();
  });

  test('rejects caller-reported totals and reasons over ten words', () => {
    const base = { ...validInsert(), key: newId(), createdAt: endedAt };
    expect(() => agentRunSchema.parse({ ...base, totalTokens: 47 })).toThrow('sum of all calls');
    expect(() => agentRunSchema.parse({ ...base, reason: 'one two three four five six seven eight nine ten eleven' })).toThrow('ten words');
    expect(() => agentRunSchema.parse({ ...base, callsCount: 2 })).toThrow('calls length');
  });
});

describe('agent run repository', () => {
  test('inserts final runs and lists them by organization key', async () => {
    const repository = createAgentRunRepository(createFakeDb());
    const run = await repository.insertRun(validInsert());
    expect(run.status).toBe('accepted');
    expect(run.key).toBeTruthy();
    expect(await repository.getRunById(run.key)).toEqual(run);
    expect(await repository.getRunById(newId())).toBeNull();
    expect(await repository.listRunsForOrganization(keys.organization)).toEqual([run]);
  });
});

describe('agent runs index setup', () => {
  test('is idempotent and indexes every analytics dimension', async () => {
    let exists = false;
    let creates = 0;
    const fields: string[] = [];
    const fake: AgentRunsSetupDatabase = {
      collection() {
        return {
          async exists() { return exists; },
          async create() { exists = true; creates += 1; return {}; },
          async ensureIndex(index) { fields.push(index.fields.join('+')); return {}; },
        };
      },
    };
    await ensureAgentRunsCollection(fake);
    await ensureAgentRunsCollection(fake);
    expect(creates).toBe(1);
    expect(fields.slice(0, 8)).toEqual([
      'organizationKey+createdAt', 'scopeKey+createdAt', 'agentKey+createdAt', 'status+createdAt',
      'skillKeys[*]', 'actionKeys[*]', 'modelKeys[*]', 'providerKeys[*]',
    ]);
    expect(fields.slice(8)).toEqual(fields.slice(0, 8));
  });
});
