import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentArtifactCheckSchema, type AgentArtifactCheck, type AgentArtifactCheckRepository } from '@/lib/ai/agent-artifact-checks';
import { toolSchema } from '@/lib/db/tools.node';
import { compileGenesisContext } from './context';
import { GENESIS_STEP_SLUGS } from './schemas';
import { GenesisManifestConsistencyError, GenesisManifestReferenceError, validateGenesisManifest } from './validation';
import { buildGenesisFixture } from './test-fixtures';

function acceptedManifest(f: ReturnType<typeof buildGenesisFixture>, overrides: Record<string, unknown> = {}) {
  const base = {
    metadata: { status: 'accepted', reason: 'Valid reusable agent architecture found', score: 0.96 },
    agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: f.scope.key, explorationRate: 0.2 },
    skills: [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }],
    agentSkills: [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }],
    agentTools: [{ operation: 'attach', toolKey: f.reasonTool.key, reason: 'Required for structured backend reasoning' }],
    steps: [...GENESIS_STEP_SLUGS],
    validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: true, permissionsValid: true, noveltyValidated: true, readyToPersist: true, missingToolSlugs: [], warnings: [] },
  };
  return { ...base, ...overrides };
}

function checkStore() {
  const values: AgentArtifactCheck[] = [];
  const repository: AgentArtifactCheckRepository = {
    async insertCheck(input) { const value = agentArtifactCheckSchema.parse({ ...input, key: input.key ?? newId(), createdAt: input.createdAt ?? '2026-07-16T00:00:00.000Z' }); values.push(value); return value; },
    async listChecksForRun() { return values; },
  };
  return { values, repository };
}

describe('Genesis manifest validation', () => {
  test('resolves an accepted manifest and generates semantic embeddings from the required fields', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const texts: string[] = []; const checks = checkStore();
    const result = await validateGenesisManifest(acceptedManifest(f), context, newId(), { checks: checks.repository, generateEmbedding: async (text) => { texts.push(text); return [1, 0]; } });
    expect(result.manifest.validation.readyToPersist).toBe(true);
    expect(result.plan.agentKey).toSatisfy((key) => typeof key === 'string' && key.startsWith('c'));
    expect(texts[0]).toBe('Forge\n\nBackend Developer');
    expect(checks.values[0]?.candidateNodeType).toBe('agent');
  });
  test('rejects unknown and cross-scope tools', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    await expect(validateGenesisManifest(acceptedManifest(f, { agentTools: [{ operation: 'attach', toolKey: newId(), reason: 'Needed' }] }), context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toBeInstanceOf(GenesisManifestReferenceError);
    const scopedTool = toolSchema.parse({ ...f.reasonTool, key: newId(), scopeKey: newId() });
    const crossScope = { ...context, knowledge: { ...context.knowledge, existingTools: [...context.knowledge.existingTools, scopedTool] } };
    await expect(validateGenesisManifest(acceptedManifest(f, { agentTools: [{ operation: 'attach', toolKey: scopedTool.key, reason: 'Needed' }] }), crossScope, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toBeInstanceOf(GenesisManifestReferenceError);
  });
  test('rejects the Beacon-only core.delegate tool for generated agents', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const delegateTool = toolSchema.parse({ key: newId(), slug: 'core.delegate', name: 'Delegate', description: 'Beacon-only delegation.', scopeKey: null });
    const withDelegate = { ...context, knowledge: { ...context.knowledge, existingTools: [...context.knowledge.existingTools, delegateTool] } };
    await expect(validateGenesisManifest(acceptedManifest(f, { agentTools: [{ operation: 'attach', toolKey: delegateTool.key, reason: 'Attempt restricted delegation' }] }), withDelegate, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toThrow('Beacon-only tool');
  });
  test('never lets Genesis create or modify the canonical Beacon identity', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Modify Beacon.' }, f);
    const beaconManifest = acceptedManifest(f, { agent: { operation: 'create', slug: 'beacon', name: 'Beacon', title: 'AI Coordinator', scopeKey: f.scope.key, explorationRate: 0.2 } });
    await expect(validateGenesisManifest(beaconManifest, context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toThrow('Beacon agent cannot be created or modified');
  });
  test('converts duplicate agent and skill creates to reuse', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Avoid duplicates.' }, f);
    const duplicateAgent = acceptedManifest(f, { agent: { operation: 'create', slug: 'genesis', name: 'Genesis', title: 'Agent Architect', scopeKey: f.scope.key, explorationRate: 0.2 } });
    const agentResult = await validateGenesisManifest(duplicateAgent, context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] });
    expect(agentResult.manifest.agent).toEqual({ operation: 'reuse', agentKey: f.genesis.key });

    const duplicateSkill = acceptedManifest(f, {
      skills: [{ operation: 'create', slug: f.backend.slug, name: f.backend.name, title: f.backend.title, definition: f.backend.definition, priority: 100 }],
      agentSkills: [{ skillRef: { type: 'created', skillSlug: f.backend.slug }, priority: 100 }],
    });
    const skillResult = await validateGenesisManifest(duplicateSkill, context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] });
    expect(skillResult.manifest.skills[0]).toEqual({ operation: 'reuse', skillKey: f.backend.key, priority: 100 });
    expect(skillResult.manifest.agentSkills[0]?.skillRef).toEqual({ type: 'existing', skillKey: f.backend.key });
  });
  test('uses name, title, and definition for new skill embeddings', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create a data skill.' }, f);
    const skill = { operation: 'create', slug: 'data-engineer', name: 'Data Engineering', title: 'Data Engineer', definition: '# Data Engineer\n\nBuild pipelines.', priority: 100 };
    const texts: string[] = [];
    await validateGenesisManifest(acceptedManifest(f, { skills: [skill], agentSkills: [{ skillRef: { type: 'created', skillSlug: skill.slug }, priority: 100 }] }), context, newId(), { checks: checkStore().repository, generateEmbedding: async (text) => { texts.push(text); return [1, 0]; } });
    expect(texts).toContain('Data Engineering\n\nData Engineer\n\n# Data Engineer\n\nBuild pipelines.');
  });
  test('rejects unlinked or mismatched skill operations', async () => {
    const f = buildGenesisFixture(); const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    await expect(validateGenesisManifest(acceptedManifest(f, { agentSkills: [] }), context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toThrow();
    const architectRelation = [{ skillRef: { type: 'existing', skillKey: f.architect.key }, priority: 100 }];
    await expect(validateGenesisManifest(acceptedManifest(f, { agentSkills: architectRelation }), context, newId(), { checks: checkStore().repository, generateEmbedding: async () => [1, 0] })).rejects.toBeInstanceOf(GenesisManifestConsistencyError);
  });
});
