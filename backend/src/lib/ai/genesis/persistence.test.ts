import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { AgentArtifactCheckRepository } from '@/lib/ai/agent-artifact-checks';
import type { GenesisTransactionGateway, GenesisTransactionWriter } from './persistence';
import { persistGenesisManifest } from './persistence';
import { compileGenesisContext } from './context';
import { GENESIS_STEP_SLUGS } from './schemas';
import { validateGenesisManifest } from './validation';
import { buildGenesisFixture } from './test-fixtures';

class MemoryTransaction implements GenesisTransactionGateway {
  committed = new Map<string, Record<string, unknown>[]>();
  constructor(private readonly failOn?: string) {}
  async execute<T>(callback: (writer: GenesisTransactionWriter) => Promise<T>): Promise<T> {
    const staged = new Map([...this.committed].map(([key, values]) => [key, structuredClone(values)]));
    const result = await callback({ save: async (collection, document) => {
      if (collection === this.failOn) throw new Error(`forced ${collection} failure`);
      const values = staged.get(collection) ?? []; values.push(structuredClone(document)); staged.set(collection, values);
    } });
    this.committed = staged;
    return result;
  }
  rows(collection: string) { return this.committed.get(collection) ?? []; }
}

const checks: AgentArtifactCheckRepository = { async insertCheck(input) { return { ...input, key: input.key ?? newId(), createdAt: input.createdAt ?? '2026-07-16T00:00:00.000Z' }; }, async listChecksForRun() { return []; } };

function manifest(f: ReturnType<typeof buildGenesisFixture>, includeNewSkill = true) {
  const createdSkill = { operation: 'create', slug: 'data-engineer', name: 'Data Engineering', title: 'Data Engineer', definition: '# Data Engineer', priority: 90 };
  return {
    metadata: { status: 'accepted', reason: 'Valid agent architecture found', score: 0.96 },
    agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: f.scope.key, explorationRate: 0.2 },
    skills: includeNewSkill ? [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }, createdSkill] : [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }],
    agentSkills: includeNewSkill ? [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }, { skillRef: { type: 'created', skillSlug: createdSkill.slug }, priority: 90 }] : [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }],
    agentTools: [{ operation: 'attach', toolKey: f.reasonTool.key, reason: 'Required reasoning capability' }],
    steps: [...GENESIS_STEP_SLUGS],
    validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: true, permissionsValid: true, noveltyValidated: true, readyToPersist: true, missingToolSlugs: [], warnings: [] },
  };
}

async function setup(includeNewSkill = true) {
  const f = buildGenesisFixture();
  const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
  const validated = await validateGenesisManifest(manifest(f, includeNewSkill), context, newId(), { checks, generateEmbedding: async () => [1, 0] });
  return { f, context, validated };
}

describe('Genesis transactional persistence', () => {
  test('atomically persists agent, skills, relations, and source/result provenance', async () => {
    const { context, validated, f } = await setup(); const transaction = new MemoryTransaction(); const runKey = newId();
    const result = await persistGenesisManifest({ runKey, context, validated }, transaction);
    expect(transaction.rows('agents')).toHaveLength(1);
    expect(transaction.rows('skills')).toHaveLength(1);
    expect(transaction.rows('agentSkills')).toHaveLength(2);
    expect(transaction.rows('agentTools')).toHaveLength(1);
    expect(result.agent.key).toBe(validated.plan.agentKey!);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeType: 'agent', relation: 'result' }),
      expect.objectContaining({ nodeType: 'skill', nodeKey: f.backend.key, relation: 'source' }),
      expect.objectContaining({ nodeType: 'tool', nodeKey: f.reasonTool.key, relation: 'source' }),
      expect.objectContaining({ nodeType: 'agent-skill', relation: 'result' }),
      expect.objectContaining({ nodeType: 'agent-tool', relation: 'result' }),
    ]));
  });
  test('rolls back every staged write when agentSkill creation fails', async () => {
    const { context, validated } = await setup(); const transaction = new MemoryTransaction('agentSkills');
    await expect(persistGenesisManifest({ runKey: newId(), context, validated }, transaction)).rejects.toThrow('forced agentSkills failure');
    expect(transaction.committed.size).toBe(0);
  });
  test('rolls back every staged write when agentTool creation fails', async () => {
    const { context, validated } = await setup(false); const transaction = new MemoryTransaction('agentTools');
    await expect(persistGenesisManifest({ runKey: newId(), context, validated }, transaction)).rejects.toThrow('forced agentTools failure');
    expect(transaction.committed.size).toBe(0);
  });
});
