import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { compileGenesisContext, GenesisOrganizationMismatchError, GenesisScopeMismatchError, renderGenesisContext } from './context';
import { buildGenesisFixture } from './test-fixtures';
import { organizationSchema } from '@/lib/db/organizations.node';
import { scopeSchema } from '@/lib/ai/scopes';

describe('Genesis context compilation', () => {
  test('loads the complete catalog and forces full exploration without sources', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create a backend agent.' }, f);
    expect(context.knowledge.existingAgents.map((agent) => agent.slug)).toEqual(['genesis']);
    expect(context.knowledge.existingSkills.map((skill) => skill.slug)).toEqual(['agent-architect', 'backend-developer']);
    expect(context.knowledge.existingTools.map((tool) => tool.slug)).toEqual(['agent.create', 'reason.solve']);
    expect(context.tools.map(({ tool }) => tool.slug)).toEqual(['agent.create']);
    expect(context.guardrails).toMatchObject({ allowedToolSlugs: ['agent.create'], allowedActionSlugs: ['agent.create'], canCreateAgents: true, canCreateTools: false, canWriteArbitraryNodes: false });
    expect(context.sourcePolicy).toEqual({ requestedExplorationRate: 0.2, effectiveExplorationRate: 1, sourceCount: 0 });
    expect(renderGenesisContext(context)).not.toContain('embedding');
    expect(renderGenesisContext(context)).not.toContain('existingSkills');
    expect(context.knowledge.pack.blocks.length).toBeGreaterThan(0);
  });
  test('resolves explicit sources and preserves requested exploration', async () => {
    const f = buildGenesisFixture();
    const context = await compileGenesisContext({ organizationKey: f.organization.key, scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Extend an existing skill.', requestedExplorationRate: 0.1, sourceRefs: [{ nodeType: 'skill', nodeKey: f.backend.key, priority: 100 }] }, f);
    expect(context.knowledge.sources[0]).toMatchObject({ nodeType: 'skill', nodeKey: f.backend.key });
    expect(context.sourcePolicy).toEqual({ requestedExplorationRate: 0.1, effectiveExplorationRate: 0.1, sourceCount: 1 });
  });
  test('rejects organization boundary violations', async () => {
    const f = buildGenesisFixture();
    await expect(compileGenesisContext({ organizationKey: newId(), scopeKey: f.scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create an agent.' }, f)).rejects.toBeInstanceOf(GenesisOrganizationMismatchError);
  });

  test('rejects a delegation context that overrides Genesis’s canonical scope', async () => {
    const f = buildGenesisFixture();
    const organization = organizationSchema.parse({ key: newId(), name: 'Customer Org', createdAt: f.now, updatedAt: f.now });
    const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 1 });
    await expect(compileGenesisContext({ organizationKey: organization.key, scopeKey: scope.key, genesisAgentKey: f.genesis.key, currentTask: 'Create a generic organization agent.' }, { ...f, executionContext: { organization, scope }, catalog: { ...f.catalog, async listOrganizationScopes() { return [scope]; } } })).rejects.toBeInstanceOf(GenesisScopeMismatchError);
  });
});
