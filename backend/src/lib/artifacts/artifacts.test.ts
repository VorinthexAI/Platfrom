import { describe, expect, test } from 'bun:test';
import { artifactDefinitionSchema, type ArtifactDefinition } from './schema';
import { compileArtifactGraph } from './service';

function definition(overrides: Partial<ArtifactDefinition> = {}): ArtifactDefinition {
  return artifactDefinitionSchema.parse({
    version: 1,
    mode: 'live',
    root: 'organization',
    nodes: {
      organization: { binding: 'currentOrganization', kind: 'organization' },
      scopes: { binding: 'organizationScopes', kind: 'scope' },
      agents: { binding: 'activeAgents', kind: 'agent', appearance: { shape: 'cube', texture: 'brushed-silver' } },
    },
    edges: [
      { from: 'organization', to: 'scopes', relation: 'contains' },
      { from: 'scopes', to: 'agents', relation: 'contains' },
    ],
    bindings: {
      currentOrganization: { kind: 'query', queryId: 'organization.current', variables: { organizationKey: { kind: 'context', value: 'organizationKey' } } },
      organizationScopes: { kind: 'query', queryId: 'organization.scopes', variables: { organizationKey: { kind: 'context', value: 'organizationKey' } } },
      activeAgents: { kind: 'query', queryId: 'scope.active-agents', variables: { scopeKey: { kind: 'context', value: 'scopeKey' } } },
    },
    view: { layout: 'tree', theme: 'obsidian', camera: 'perspective', textures: { organization: 'chrome-core', scope: 'smoked-glass' }, spacing: 1 },
    ...overrides,
  });
}

describe('spatial artifact definition', () => {
  test('stores semantic graph groups and registered binding references, not UI components or values', () => {
    const parsed = definition();
    expect(parsed.root).toBe('organization');
    expect(parsed.nodes.agents).toEqual({ binding: 'activeAgents', kind: 'agent', appearance: { shape: 'cube', texture: 'brushed-silver' } });
    expect(JSON.stringify(parsed)).not.toContain('card');
    expect(JSON.stringify(parsed)).not.toContain('accordion');
    expect(JSON.stringify(parsed)).not.toContain('500K');
  });

  test('rejects the retired renderer/layout-node contract and raw executable queries', () => {
    expect(() => artifactDefinitionSchema.parse({ version: 1, mode: 'live', renderer: 'dashboard', layout: { type: 'metric' }, bindings: {} })).toThrow();
    expect(() => artifactDefinitionSchema.parse({
      ...definition(),
      bindings: { currentOrganization: { kind: 'query', query: 'FOR x IN organizations RETURN x' } },
    })).toThrow();
  });

  test('keeps generated positions out of dynamic layouts and requires them for manual layouts', () => {
    expect(() => definition({ view: { ...definition().view, layout: 'tree', positions: { node: [1, 2, 3] } } })).toThrow('Only manual layout');
    expect(() => definition({ view: { ...definition().view, layout: 'manual' } })).toThrow('Manual layout');
  });

  test('validates roots, edges, bindings, and binding cycles', () => {
    expect(() => definition({ root: 'missing' })).toThrow('Root');
    expect(() => definition({ edges: [{ from: 'missing', to: 'agents', relation: 'contains', directed: true }] })).toThrow('Unknown node group');
    expect(() => definition({ nodes: { organization: { binding: 'missing', kind: 'organization' } } })).toThrow('Unknown binding alias');
  });
});

describe('semantic graph compiler', () => {
  test('normalizes live rows into stable NodeRefs and relation edges', () => {
    const graph = compileArtifactGraph(definition(), {
      currentOrganization: { ref: { nodeType: 'organizations', nodeKey: 'root-org' }, name: 'Vorinthex AI', state: 'active' },
      organizationScopes: [{ ref: { nodeType: 'scopes', nodeKey: 'scope-1' }, parentRef: { nodeType: 'organizations', nodeKey: 'root-org' }, name: 'Nexus' }],
      activeAgents: [{ ref: { nodeType: 'agents', nodeKey: 'agent-1' }, parentRef: { nodeType: 'scopes', nodeKey: 'scope-1' }, name: 'Test Agent', state: 'active', weight: 1.4 }],
    });
    expect(graph.nodes.map((node) => ({ id: node.id, ref: node.ref, kind: node.kind }))).toEqual([
      { id: 'organization:organizations:root-org', ref: { nodeType: 'organizations', nodeKey: 'root-org' }, kind: 'organization' },
      { id: 'scopes:scopes:scope-1', ref: { nodeType: 'scopes', nodeKey: 'scope-1' }, kind: 'scope' },
      { id: 'agents:agents:agent-1', ref: { nodeType: 'agents', nodeKey: 'agent-1' }, kind: 'agent' },
    ]);
    expect(graph.edges.map((edge) => edge.relation)).toEqual(['contains', 'contains']);
    expect(graph.nodes[2]?.appearance).toEqual({ shape: 'cube', texture: 'brushed-silver' });
  });

  test('rejects query rows that do not preserve a first-class NodeRef', () => {
    expect(() => compileArtifactGraph(definition(), { currentOrganization: { name: 'Hardcoded organization' }, organizationScopes: [], activeAgents: [] })).toThrow('NodeRef');
  });
});
