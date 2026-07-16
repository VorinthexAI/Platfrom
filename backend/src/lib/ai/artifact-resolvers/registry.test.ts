import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { ArtifactResolverRegistry, ArtifactSourceOrganizationError, ArtifactSourcePermissionError, resolveArtifactContent, resolveArtifactSources, type ArtifactResolver } from './registry';

function resolver(reference: { nodeType: string; nodeKey: string; organizationKey: string; scopeKey: string | null; name: string; summary: string }): ArtifactResolver {
  return {
    async exists(key) { return key === reference.nodeKey; },
    async getReference(key) { return key === reference.nodeKey ? reference : null; },
    async getContent(key) { return key === reference.nodeKey ? { body: 'full content stays here' } : null; },
    async findSimilar() { return []; },
  };
}

describe('artifact source resolution', () => {
  test('sorts explicit sources and injects compact references only', async () => {
    const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId(); const low = newId(); const high = newId();
    const registry = new ArtifactResolverRegistry()
      .register('image', resolver({ nodeType: 'image', nodeKey: low, organizationKey, scopeKey, name: 'Low', summary: 'Lower priority' }))
      .register('blog-post', resolver({ nodeType: 'blog-post', nodeKey: high, organizationKey, scopeKey, name: 'High', summary: 'Higher priority' }));
    const references = await resolveArtifactSources({ organizationKey, scopeKey, agentKey, registry, selections: [{ nodeType: 'image', nodeKey: low, priority: 10 }, { nodeType: 'blog-post', nodeKey: high, priority: 100 }] });
    expect(references.map((item) => item.name)).toEqual(['High', 'Low']);
    expect(references[0]).toEqual({ nodeType: 'blog-post', nodeKey: high, name: 'High', summary: 'Higher priority' });
    expect(references[0]).not.toHaveProperty('organizationKey');
  });
  test('rejects cross-organization and unauthorized sources', async () => {
    const nodeKey = newId(); const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId();
    const registry = new ArtifactResolverRegistry().register('image', resolver({ nodeType: 'image', nodeKey, organizationKey: newId(), scopeKey, name: 'Image', summary: 'Summary' }));
    await expect(resolveArtifactSources({ organizationKey, scopeKey, agentKey, registry, selections: [{ nodeType: 'image', nodeKey, priority: 1 }] })).rejects.toBeInstanceOf(ArtifactSourceOrganizationError);
    const allowedRegistry = new ArtifactResolverRegistry().register('image', resolver({ nodeType: 'image', nodeKey, organizationKey, scopeKey, name: 'Image', summary: 'Summary' }));
    await expect(resolveArtifactSources({ organizationKey, scopeKey, agentKey, registry: allowedRegistry, canUseSource: () => false, selections: [{ nodeType: 'image', nodeKey, priority: 1 }] })).rejects.toBeInstanceOf(ArtifactSourcePermissionError);
  });
  test('retrieves full content only through the permission-checked server primitive', async () => {
    const nodeKey = newId(); const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId();
    const registry = new ArtifactResolverRegistry().register('document', resolver({ nodeType: 'document', nodeKey, organizationKey, scopeKey, name: 'Plan', summary: 'Compact plan' }));
    expect(await resolveArtifactContent<{ body: string }>({ organizationKey, scopeKey, agentKey, registry, nodeType: 'document', nodeKey })).toEqual({ body: 'full content stays here' });
    await expect(resolveArtifactContent({ organizationKey, scopeKey, agentKey, registry, nodeType: 'document', nodeKey, canUseSource: () => false })).rejects.toBeInstanceOf(ArtifactSourcePermissionError);
  });
});
