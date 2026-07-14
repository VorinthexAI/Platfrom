import { describe, expect, test } from 'bun:test';
import { createAgentRunRepository } from './repository';
import { ensureAgentRunsCollection } from './indexes';
import { agentRunSchema } from './schema';
import { AgentRunNotFoundError, type AgentRunsDatabase, type AgentRunsSetupDatabase } from './types';

function createFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();

  const fake: AgentRunsDatabase = {
    async query(_query: string, bindVars: Record<string, unknown> = {}) {
      const rows = [...docs.values()]
        .filter((doc) => doc.organizationId === bindVars.organizationId)
        .sort((a, b) => (String(a.createdAt) > String(b.createdAt) ? -1 : 1))
        .slice(0, typeof bindVars.limit === 'number' ? bindVars.limit : 50);
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection() {
      return {
        async save(doc: Record<string, unknown>) {
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async update(key: string, patch: Record<string, unknown>) {
          const existing = docs.get(key);
          if (!existing) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          const merged = { ...existing, ...patch };
          docs.set(key, merged);
          return { new: merged };
        },
        async document(key: string) {
          const doc = docs.get(key);
          if (!doc) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          return doc;
        },
      };
    },
  };

  return { fake, docs };
}

const baseInsert = {
  organizationId: 'org1',
  agentId: 'vorinthex.assistant',
  toolId: 'ask.answer',
  actionId: 'core.ask',
  status: 'running',
  startedAt: '2026-07-14T00:00:00.000Z',
} as const;

describe('agent run schema', () => {
  test('applies safe defaults and strips Arango system fields', () => {
    const run = agentRunSchema.parse({
      ...baseInsert,
      key: 'run1',
      _key: 'run1',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(run.steps).toEqual([]);
    expect(run.output).toBeNull();
    expect(run.error).toBeNull();
    expect(run.modelId).toBeNull();
    expect((run as Record<string, unknown>)._key).toBeUndefined();
  });

  test('rejects unknown statuses and malformed usage', () => {
    expect(() =>
      agentRunSchema.parse({ ...baseInsert, key: 'x', status: 'pending', createdAt: 'a', updatedAt: 'a' }),
    ).toThrow();
    expect(() =>
      agentRunSchema.parse({
        ...baseInsert,
        key: 'x',
        usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 },
        createdAt: 'a',
        updatedAt: 'a',
      }),
    ).toThrow();
  });
});

describe('agent run repository', () => {
  test('inserts running runs and updates them through the lifecycle', async () => {
    const { fake } = createFakeDb();
    const repository = createAgentRunRepository(fake);

    const run = await repository.insertRun(baseInsert);
    expect(run.status).toBe('running');
    expect(run.key.length).toBeGreaterThan(0);

    const succeeded = await repository.updateRun(run.key, {
      status: 'succeeded',
      modelId: 'anthropic.claude-sonnet',
      providerId: 'anthropic',
      externalModelId: 'claude-sonnet-4-5',
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
      steps: [
        { index: 0, type: 'route-selected', at: '2026-07-14T00:00:01.000Z', modelId: 'anthropic.claude-sonnet' },
        { index: 1, type: 'provider-executed', at: '2026-07-14T00:00:02.000Z', durationMs: 900 },
      ],
      output: { type: 'core.ask', stopReason: 'end_turn' },
      finishedAt: '2026-07-14T00:00:02.000Z',
      durationMs: 2000,
    });
    expect(succeeded.status).toBe('succeeded');
    expect(succeeded.usage.totalTokens).toBe(46);
    expect(succeeded.steps).toHaveLength(2);
    expect(succeeded.output?.stopReason).toBe('end_turn');

    expect(await repository.getRunById(run.key)).toEqual(succeeded);
    expect(await repository.getRunById('missing')).toBeNull();

    const listed = await repository.listRunsForOrganization('org1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe(run.key);
  });

  test('updating a missing run fails deterministically', async () => {
    const { fake } = createFakeDb();
    const repository = createAgentRunRepository(fake);
    expect(repository.updateRun('missing', { status: 'failed' })).rejects.toBeInstanceOf(AgentRunNotFoundError);
  });
});

describe('agent runs index setup', () => {
  test('is idempotent and covers the read paths', async () => {
    let exists = false;
    let createCalls = 0;
    const ensured: Array<{ fields: string[] }> = [];
    const fake: AgentRunsSetupDatabase = {
      collection() {
        return {
          async exists() {
            return exists;
          },
          async create() {
            exists = true;
            createCalls += 1;
            return {};
          },
          async ensureIndex(index) {
            ensured.push(index);
            return {};
          },
        };
      },
    };
    await ensureAgentRunsCollection(fake);
    await ensureAgentRunsCollection(fake);
    expect(createCalls).toBe(1);
    expect(ensured.map((index) => index.fields.join('+'))).toEqual([
      'organizationId+createdAt',
      'agentId+createdAt',
      'status',
      'organizationId+createdAt',
      'agentId+createdAt',
      'status',
    ]);
  });
});
