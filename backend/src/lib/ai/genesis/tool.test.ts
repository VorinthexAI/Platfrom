import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { compileGenesisContext } from './context';
import { GENESIS_STEP_SLUGS, genesisCreationManifestSchema } from './schemas';
import { buildGenesisFixture } from './test-fixtures';
import { CreateAgentToolGuardrailError, createAgentToolInputSchema, createAgentToolOutputSchema, executeCreateAgentTool } from './tool';

function rejectedManifest(f: ReturnType<typeof buildGenesisFixture>) {
  return genesisCreationManifestSchema.parse({
    metadata: { status: 'rejected', reason: 'Required tool is unavailable', score: 0.99 },
    agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: f.scope.key, explorationRate: 0.2 },
    skills: [{ operation: 'reuse', skillKey: f.backend.key, priority: 100 }],
    agentSkills: [{ skillRef: { type: 'existing', skillKey: f.backend.key }, priority: 100 }],
    agentTools: [],
    steps: [...GENESIS_STEP_SLUGS],
    validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: false, permissionsValid: true, noveltyValidated: true, readyToPersist: false, missingToolSlugs: ['repository'], warnings: [] },
  });
}

describe('agent.create local action handler', () => {
  test('uses strict input and output contracts', () => {
    const f = buildGenesisFixture();
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    expect(createAgentToolInputSchema.parse(input)).toEqual(input);
    expect(() => createAgentToolInputSchema.parse({ ...input, arbitraryWrite: true })).toThrow();
    expect(() => createAgentToolOutputSchema.parse({ status: 'created', agentKey: newId(), createdSkillKeys: [], reusedSkillKeys: [], agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: 'Created', extra: true })).toThrow();
  });

  test('returns a rejected result without entering a write transaction', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    let writes = 0;
    const result = await executeCreateAgentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) }, context, { transaction: { async execute() { writes += 1; throw new Error('must not write'); } } });
    expect(result.output).toEqual({ status: 'rejected', agentKey: null, createdSkillKeys: [], reusedSkillKeys: [], agentSkillKeys: [], agentToolKeys: [], scopeAgentKey: null, agentMemberKeys: [], artifactKeys: [], reason: 'Required tool is unavailable' });
    expect(writes).toBe(0);
  });

  test('rejects organization and scope context mismatches before writes', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    await expect(executeCreateAgentTool({ organizationKey: newId(), scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) }, context)).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
    await expect(executeCreateAgentTool({ organizationKey: f.organization.key, scopeKey: newId(), agentRunKey: newId(), manifest: rejectedManifest(f) }, context)).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
  });

  test('rejects extra Genesis tools and an invalid agent.create mapping', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create Forge.' }, f);
    const input = { organizationKey: f.organization.key, scopeKey: f.scope.key, agentRunKey: newId(), manifest: rejectedManifest(f) };
    await expect(executeCreateAgentTool(input, { ...context, tools: [...context.tools, context.tools[0]!] })).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
    await expect(executeCreateAgentTool(input, { ...context, tools: [{ ...context.tools[0]!, actions: [] }] })).rejects.toBeInstanceOf(CreateAgentToolGuardrailError);
  });
});
