import { describe, expect, test } from 'bun:test';
import { compileArtifactScene } from '@/lib/artifacts/scene-compiler';
import type { ArtifactLayout, ResolvedArtifact } from './types';

function resolved(layout: ArtifactLayout): ResolvedArtifact {
  return {
    artifact: {
      key: 'cmspatialartifact000000000001', organizationKey: 'root-org', scopeKey: 'cmrnlzf640000qc7k4p5zem5w', name: 'Organization', schemaVersion: 1, snapshotKey: null, createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
      definition: {
        version: 1, mode: 'live', root: 'organization',
        nodes: { organization: { binding: 'organization', kind: 'organization' }, scopes: { binding: 'scopes', kind: 'scope' } },
        edges: [{ from: 'organization', to: 'scopes', relation: 'contains', directed: true }], bindings: { organization: { kind: 'query' }, scopes: { kind: 'query' } },
        view: { layout, theme: 'obsidian', camera: 'perspective', textures: { organization: 'chrome-core' }, spacing: 1 },
      },
    },
    graph: {
      nodes: [
        { id: 'organization:organizations:root-org', ref: { nodeType: 'organizations', nodeKey: 'root-org' }, group: 'organization', kind: 'organization', label: 'Vorinthex AI', state: 'active', weight: 1, parentRef: null, clusterId: null, details: { name: 'Vorinthex AI' } },
        { id: 'scopes:scopes:nexus', ref: { nodeType: 'scopes', nodeKey: 'nexus' }, group: 'scopes', kind: 'scope', label: 'Nexus', state: 'active', weight: 1, parentRef: { nodeType: 'organizations', nodeKey: 'root-org' }, clusterId: 'root-org', details: { name: 'Nexus' } },
      ],
      edges: [{ id: 'edge', from: 'organization:organizations:root-org', to: 'scopes:scopes:nexus', relation: 'contains', directed: true }],
    },
    revisions: { organization: 'rev-1', scopes: 'rev-2' },
  };
}

describe('spatial artifact scene compiler', () => {
  test('renders the same semantic graph through different layout engines without changing refs', () => {
    const tree = compileArtifactScene(resolved('tree')); const orbit = compileArtifactScene(resolved('orbit'));
    expect(tree.nodes.map((node) => node.ref)).toEqual(orbit.nodes.map((node) => node.ref));
    expect(tree.nodes.map((node) => node.position)).not.toEqual(orbit.nodes.map((node) => node.position));
    expect(tree.layout.id).toBe('tree'); expect(orbit.layout.id).toBe('orbit');
  });

  test('compiles registered themes and material tokens into scene-only appearance', () => {
    const scene = compileArtifactScene(resolved('radial'));
    expect(scene.nodes[0]?.appearance.texture).toBe('chrome-core');
    expect(scene.nodes[0]?.appearance.color).toMatch(/^#/);
    expect(scene.appearance.background).toMatch(/^#/);
    expect(scene.edges[0]?.fromPosition).toEqual(scene.nodes[0]?.position);
  });

  test('keeps every adaptive layout registered and finite', () => {
    const layouts: ArtifactLayout[] = ['tree', 'cluster', 'galaxy', 'timeline', 'hierarchy', 'radial', 'force', 'grid', 'flow', 'orbit', 'layered'];
    for (const layout of layouts) {
      const scene = compileArtifactScene(resolved(layout));
      expect(scene.layout.id).toBe(layout);
      expect(scene.nodes.every((node) => node.position.every(Number.isFinite))).toBe(true);
    }
  });
});
