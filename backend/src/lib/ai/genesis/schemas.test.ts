import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import {
  GENESIS_STEP_SLUGS,
  genesisAgentCreateSchema,
  genesisAgentReuseSchema,
  genesisCreationManifestSchema,
  genesisSourcePolicySchema,
} from './schemas';

function manifest(status: 'accepted' | 'rejected' = 'accepted') {
  return {
    metadata: { status, reason: status === 'accepted' ? 'Valid agent architecture found' : 'Required tool is unavailable', score: 0.9 },
    agent: { operation: 'create', slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: newId(), explorationRate: 0.2 },
    skills: [{ operation: 'reuse', skillKey: newId(), priority: 100 }],
    agentSkills: [{ skillRef: { type: 'existing', skillKey: newId() }, priority: 100 }],
    agentTools: [], steps: [...GENESIS_STEP_SLUGS],
    validation: { scopeExists: true, agentIsUnique: true, allSkillsResolved: true, allToolsResolved: true, permissionsValid: true, noveltyValidated: true, readyToPersist: status === 'accepted', missingToolSlugs: [], warnings: [] },
  };
}

describe('Genesis manifest schemas', () => {
  test('reject prose-only output, missing metadata, and manifests without skills', () => {
    expect(() => genesisCreationManifestSchema.parse('Here is the agent.')).toThrow();
    const valid = manifest();
    expect(() => genesisCreationManifestSchema.parse({ ...valid, metadata: undefined })).toThrow();
    expect(() => genesisCreationManifestSchema.parse({ ...valid, skills: [] })).toThrow();
  });
  test('enforces slugs, CUID reuse keys, and ten-word metadata reasons', () => {
    expect(() => genesisAgentCreateSchema.parse({ operation: 'create', slug: 'Not Valid', name: 'X', title: 'X', scopeKey: newId() })).toThrow();
    expect(() => genesisAgentReuseSchema.parse({ operation: 'reuse', agentKey: 'not-a-cuid' })).toThrow();
    const valid = manifest();
    expect(() => genesisCreationManifestSchema.parse({ ...valid, metadata: { status: 'accepted', reason: 'one two three four five six seven eight nine ten eleven', score: 1 } })).toThrow();
  });
  test('ties accepted and rejected status to readiness', () => {
    expect(genesisCreationManifestSchema.parse(manifest('accepted')).metadata.status).toBe('accepted');
    expect(genesisCreationManifestSchema.parse(manifest('rejected')).metadata.status).toBe('rejected');
    expect(() => genesisCreationManifestSchema.parse({ ...manifest('accepted'), validation: { ...manifest('accepted').validation, readyToPersist: false } })).toThrow();
    expect(() => genesisCreationManifestSchema.parse({ ...manifest('rejected'), validation: { ...manifest('rejected').validation, readyToPersist: true } })).toThrow();
  });
  test('derives exploration from source availability', () => {
    expect(genesisSourcePolicySchema.parse({ requestedExplorationRate: 0.2, effectiveExplorationRate: 1, sourceCount: 0 }).effectiveExplorationRate).toBe(1);
    expect(genesisSourcePolicySchema.parse({ requestedExplorationRate: 0.2, effectiveExplorationRate: 0.2, sourceCount: 1 }).effectiveExplorationRate).toBe(0.2);
    expect(() => genesisSourcePolicySchema.parse({ requestedExplorationRate: 0.2, effectiveExplorationRate: 0.2, sourceCount: 0 })).toThrow();
  });
});
