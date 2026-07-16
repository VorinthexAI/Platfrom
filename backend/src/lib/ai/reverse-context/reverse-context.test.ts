import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { buildKnowledgePack } from './knowledge-pack';
import { ArtifactReadGrantError, executeArtifactReadTool, runArtifactReadTool } from './artifact-read';
import { ReverseContextCompiler } from './compiler';
import { createNodeResolver, type SearchableDocument } from './resolver-factory';
import { NodeContextNotFoundError, NodeResolverRegistry } from './resolver';
import { rankKnowledgeBlocks } from './ranking';
import { searchableNodeSchema, type KnowledgeBlock } from './schema';
import { organizationSchema } from '@/lib/db/organizations.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { toolSchema } from '@/lib/db/tools.node';
import { actionSchema } from '@/lib/db/actions.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import type { AgentRuntimeDataSource } from '@/lib/ai/agents';

function setup() {
  const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId();
  const manualKey = newId(); const automaticKey = newId(); const foreignKey = newId();
  const documents: SearchableDocument[] = [
    { key: manualKey, organizationKey, scopeKey, embedding: [0, 1], name: 'Manual Architecture', title: 'Manual', definition: 'Authoritative source details.', _key: 'must-never-leak' },
    { key: automaticKey, organizationKey, scopeKey, embedding: [1, 0], name: 'Automatic Match', title: 'Automatic', definition: 'Best vector match.', secret: 'must-never-leak' },
    { key: foreignKey, organizationKey: newId(), scopeKey, embedding: [1, 0], name: 'Foreign', title: 'Foreign', definition: 'Forbidden.' },
  ];
  const byKey = new Map(documents.map((document) => [document.key, document]));
  const resolver = createNodeResolver({ nodeType: 'skill', embeddingFields: ['name', 'title', 'definition'], titleField: 'title', summaryFields: ['name', 'title'], contentFields: ['name', 'title', 'definition'], data: { async get(key) { return byKey.get(key) ?? null; }, async list() { return documents; } } });
  const registry = new NodeResolverRegistry().register(resolver);
  return { organizationKey, scopeKey, agentKey, manualKey, automaticKey, foreignKey, registry };
}

describe('reverse context compiler', () => {
  test('uses embeddingFields as the only normalized node data', async () => {
    const f = setup();
    const node = await f.registry.get('skill').load(f.automaticKey, f);
    expect(searchableNodeSchema.parse(node).fields).toEqual({ name: 'Automatic Match', title: 'Automatic', definition: 'Best vector match.' });
    expect(JSON.stringify(node)).not.toContain('secret');
  });

  test('ranks manual sources first, deduplicates, and filters foreign nodes', async () => {
    const f = setup();
    const compiler = new ReverseContextCompiler({ registry: f.registry, generateEmbedding: async () => [1, 0], defaultTokenBudget: 2_000 });
    const pack = await compiler.compile({ ...f, query: 'Find architecture', manualSources: [{ nodeType: 'skill', nodeKey: f.manualKey, priority: 100 }], topN: 20 });
    expect(pack.blocks.map(({ nodeKey }) => nodeKey)).toEqual([f.manualKey, f.automaticKey]);
    expect(pack.blocks[0]?.content).toBeNull();
    expect(JSON.stringify(pack)).not.toContain('must-never-leak');
    expect(JSON.stringify(pack)).not.toContain(f.foreignKey);
  });

  test('forces reference-only blocks even when a resolver returns eager content', async () => {
    const f = setup(); const resolver = f.registry.get('skill'); const extract = resolver.extractContext.bind(resolver);
    resolver.extractContext = async (node, access, options) => ({ ...await extract(node, access, options), content: 'eager full repository content' });
    const pack = await new ReverseContextCompiler({ registry: f.registry, generateEmbedding: async () => [1, 0] }).compile({ ...f, query: 'Find knowledge' });
    expect(pack.blocks.every(({ content }) => content === null)).toBe(true);
    expect(JSON.stringify(pack)).not.toContain('eager full repository content');
  });

  test('uses the universal top-20 automatic search default', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId();
    const documents: SearchableDocument[] = Array.from({ length: 25 }, (_, index) => ({ key: newId(), organizationKey, scopeKey, embedding: [1, index / 100], name: `Node ${index}` }));
    const byKey = new Map(documents.map((document) => [document.key, document]));
    const registry = new NodeResolverRegistry().register(createNodeResolver({ nodeType: 'document', embeddingFields: ['name'], data: { async get(key) { return byKey.get(key) ?? null; }, async list() { return documents; } } }));
    const pack = await new ReverseContextCompiler({ registry, generateEmbedding: async () => [1, 0], defaultTokenBudget: 20_000 }).compile({ organizationKey, scopeKey, agentKey, query: 'Find nodes' });
    expect(pack.blocks).toHaveLength(20);
  });

  test('compresses in ranked order and enforces the token budget', async () => {
    const block = (key: string, title: string): KnowledgeBlock => ({ nodeType: 'skill', nodeKey: key, title, summary: 'S'.repeat(1_000), content: 'C'.repeat(5_000), metadata: {} });
    const ranked = rankKnowledgeBlocks([
      { block: block(newId(), 'Manual'), source: 'manual', similarity: 0.1, priority: 100, updatedAt: null },
      { block: block(newId(), 'Automatic'), source: 'automatic', similarity: 1, priority: 0, updatedAt: null },
    ]);
    const pack = await buildKnowledgePack(ranked, { query: 'Budgeted pack', tokenBudget: 350, maxSummaryCharacters: 200, maxContentCharacters: 500, summarizer: async () => 'Compressed summary' });
    expect(pack.budget.estimatedTokens).toBeLessThanOrEqual(350);
    expect(pack.budget.compressedBlocks).toBeGreaterThan(0);
    expect(pack.blocks[0]?.title).toBe('Manual');
  });

  test('lazy artifact reads return the full safe projection and repeat permissions', async () => {
    const f = setup();
    const block = await executeArtifactReadTool({ organizationKey: f.organizationKey, scopeKey: f.scopeKey, agentKey: f.agentKey, nodeType: 'skill', nodeKey: f.automaticKey }, f.registry);
    expect(block.content).toContain('Best vector match.');
    expect(JSON.stringify(block)).not.toContain('secret');
    await expect(executeArtifactReadTool({ organizationKey: f.organizationKey, scopeKey: newId(), agentKey: f.agentKey, nodeType: 'skill', nodeKey: f.automaticKey }, f.registry)).rejects.toBeInstanceOf(NodeContextNotFoundError);
  });

  test('requires the persisted artifact.read tool/action grant at the callable boundary', async () => {
    const f = setup(); const now = '2026-07-16T00:00:00.000Z';
    const organization = organizationSchema.parse({ key: f.organizationKey, name: 'Vorinthex', createdAt: now, updatedAt: now });
    const scope = scopeSchema.parse({ key: f.scopeKey, organizationKey: f.organizationKey, slug: 'platform', name: 'Platform', description: 'Platform scope' });
    const agent = agentSchema.parse({ key: f.agentKey, slug: 'reader', name: 'Reader', title: 'Researcher', scopeKey: f.scopeKey });
    const skill = skillSchema.parse({ key: newId(), slug: 'researcher', name: 'Research', title: 'Researcher', definition: 'Read sources.' });
    const tool = toolSchema.parse({ key: newId(), slug: 'artifact.read', name: 'Read Artifact', description: 'Read authorized artifacts.' });
    const action = actionSchema.parse({ key: newId(), slug: 'artifact.read', name: 'Read Artifact', description: 'Read one artifact.', objective: 'Read safely.', inputDescription: 'Reference.', outputDescription: 'Knowledge block.', handlerKey: 'artifact.read' });
    const runtimeData = (granted: boolean): AgentRuntimeDataSource => ({
      async getAgent(key) { return key === agent.key ? agent : null; }, async getScope(key) { return key === scope.key ? scope : null; }, async getOrganization(key) { return key === organization.key ? organization : null; },
      async listAgentSkills() { return [agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 })]; }, async getSkill(key) { return key === skill.key ? skill : null; },
      async listAgentTools() { return granted ? [agentToolSchema.parse({ key: newId(), agentKey: agent.key, toolKey: tool.key })] : []; }, async getTool(key) { return key === tool.key ? tool : null; },
      async listToolActions() { return [toolActionSchema.parse({ key: newId(), toolKey: tool.key, actionKey: action.key, priority: 100, enabled: true })]; }, async getAction(key) { return key === action.key ? action : null; },
    });
    const input = { organizationKey: f.organizationKey, scopeKey: f.scopeKey, agentKey: f.agentKey, nodeType: 'skill', nodeKey: f.automaticKey };
    await expect(runArtifactReadTool(input, { registry: f.registry, runtimeData: runtimeData(false) })).rejects.toBeInstanceOf(ArtifactReadGrantError);
    expect((await runArtifactReadTool(input, { registry: f.registry, runtimeData: runtimeData(true) })).content).toContain('Best vector match.');
  });
});
