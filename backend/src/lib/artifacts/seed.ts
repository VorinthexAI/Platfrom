import type { Database } from 'arangojs';
import { toArangoDoc } from '@/lib/db/base';
import { artifactDependencySchema, artifactSchema, ARTIFACT_DEPENDENCIES_COLLECTION, ARTIFACTS_COLLECTION } from './schema';

export const NEXUS_ORGANIZATION_ARTIFACT_KEY = 'cmspatialartifact000000000001';

export async function seedNexusOrganizationArtifact(database: Database, organizationKey: string, scopeKey: string) {
  const now = new Date().toISOString();
  const artifact = artifactSchema.parse({
    key: NEXUS_ORGANIZATION_ARTIFACT_KEY,
    organizationKey,
    scopeKey,
    name: 'Nexus organization graph',
    schemaVersion: 1,
    snapshotKey: null,
    createdByAgentRunKey: null,
    createdByUserOrganizationKey: null,
    createdAt: now,
    updatedAt: now,
    definition: {
      version: 1,
      mode: 'live',
      root: 'organization',
      nodes: {
        organization: { binding: 'currentOrganization', kind: 'organization' },
        scopes: { binding: 'organizationScopes', kind: 'scope' },
        agents: { binding: 'activeAgents', kind: 'agent' },
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
      view: {
        layout: 'orbit',
        theme: 'obsidian',
        camera: 'perspective',
        textures: { organization: 'chrome-core', scope: 'smoked-glass', agent: 'brushed-silver' },
        spacing: 1,
      },
    },
  });
  const existing = await database.collection(ARTIFACTS_COLLECTION).document(NEXUS_ORGANIZATION_ARTIFACT_KEY).catch(() => null) as { createdAt?: string } | null;
  await database.collection(ARTIFACTS_COLLECTION).save(toArangoDoc({ ...artifact, createdAt: existing?.createdAt ?? artifact.createdAt }), { overwriteMode: 'replace' });

  await database.query('FOR dependency IN @@collection FILTER dependency.artifactKey == @artifactKey REMOVE dependency IN @@collection', { '@collection': ARTIFACT_DEPENDENCIES_COLLECTION, artifactKey: artifact.key });
  const dependencies = [
    { key: 'cmspatialdependency000000001', dependencyType: 'organization', nodeKey: organizationKey, queryId: null },
    { key: 'cmspatialdependency000000002', dependencyType: 'scope', nodeKey: scopeKey, queryId: null },
    { key: 'cmspatialdependency000000003', dependencyType: 'query', nodeKey: null, queryId: 'organization.current' },
    { key: 'cmspatialdependency000000004', dependencyType: 'query', nodeKey: null, queryId: 'organization.scopes' },
    { key: 'cmspatialdependency000000005', dependencyType: 'query', nodeKey: null, queryId: 'scope.active-agents' },
  ];
  for (const dependency of dependencies) {
    const parsed = artifactDependencySchema.parse({ ...dependency, artifactKey: artifact.key, organizationKey, scopeKey, nodeType: null, referencedArtifactKey: null, createdAt: now });
    await database.collection(ARTIFACT_DEPENDENCIES_COLLECTION).save(toArangoDoc(parsed), { overwriteMode: 'replace' });
  }
}
