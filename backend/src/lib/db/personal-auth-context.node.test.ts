import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import {
  buildDefaultPersonalContainers,
  DEFAULT_CONTENT_FOLDER_NAME,
  DEFAULT_IMAGE_COLLECTION_NAME,
  isGuestPersonalIdentity,
} from './personal-auth-context.node';

const provisioningSource = await Bun.file(new URL('./personal-auth-context.node.ts', import.meta.url)).text();

describe('default personal containers', () => {
  test('builds schema-valid owned root containers in the personal scope', () => {
    const now = '2026-08-11T12:00:00.000Z';
    const scopeKey = newId();
    const membershipKey = newId();
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25);
    const containers = buildDefaultPersonalContainers({
      scopeKey,
      membershipKey,
      collectionKey: newId(),
      collectionMembershipKey: newId(),
      folderKey: newId(),
      collectionEmbedding: embedding,
      folderEmbedding: embedding,
      now,
    });

    expect(containers.collection).toMatchObject({ scopeKey, name: DEFAULT_IMAGE_COLLECTION_NAME, embedding, createdAt: now, updatedAt: now });
    expect(containers.collectionMembership).toMatchObject({ scopeKey, collectionKey: containers.collection.key, memberKey: membershipKey, role: 'owner', createdAt: now });
    expect(containers.folder).toMatchObject({ scopeKey, name: DEFAULT_CONTENT_FOLDER_NAME, embedding, createdAt: now, updatedAt: now });
    expect(containers.folder).not.toHaveProperty('parentFolderKey');
    expect(containers.collection).not.toHaveProperty('_key');
    expect(containers.collectionMembership).not.toHaveProperty('_key');
    expect(containers.folder).not.toHaveProperty('_key');
  });

  test('rejects embeddings that are not the current dimensions', () => {
    expect(() => buildDefaultPersonalContainers({
      scopeKey: newId(),
      membershipKey: newId(),
      collectionKey: newId(),
      collectionMembershipKey: newId(),
      folderKey: newId(),
      collectionEmbedding: Array(EMBEDDING_DIMENSIONS - 1).fill(0.25),
      folderEmbedding: Array(EMBEDDING_DIMENSIONS).fill(0.25),
      now: '2026-08-11T12:00:00.000Z',
    })).toThrow();
  });

  test('identifies only guest-bootstrap users as guests', () => {
    expect(isGuestPersonalIdentity({ guestBootstrapSecretHash: 'hash' })).toBe(true);
    expect(isGuestPersonalIdentity({ guestBootstrapSecretHash: null })).toBe(false);
    expect(isGuestPersonalIdentity({})).toBe(false);
  });

  test('initializes canonical mail tones for new and existing personal contexts', () => {
    expect(provisioningSource).toContain('async function ensurePersonalMailDefaults(scopeKey: string)');
    expect(provisioningSource).toContain('createEmailRepository(db).initializeTones(scopeKey)');
    expect(provisioningSource.match(/ensurePersonalMailDefaults\(/g)).toHaveLength(3);
  });
});
