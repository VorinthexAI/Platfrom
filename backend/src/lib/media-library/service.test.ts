import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createHash } from 'node:crypto';
import { createMediaLibraryService, mediaLibraryRequestFingerprint, hashMediaLibrarySharePassword, verifyMediaLibrarySharePassword, type MediaLibraryRepository } from './index';

const now = '2026-08-07T12:00:00.000Z'; const later = '2026-08-08T12:00:00.000Z';
function repository(overrides: Partial<MediaLibraryRepository> = {}): MediaLibraryRepository {
  return { getImage: async () => null, getCollection: async () => null, ownsImage: async () => true, canAccessImage: async () => true, ownsCollection: async () => true, addImageToCollection: async (value) => value, copyImageToCollection: async (value) => value, moveImageBetweenCollections: async (_source, value) => value, leaveCollection: async () => true, createCollectionInvite: async (value, replay) => ({ invite: value, ...replay }), getAcceptedCollectionInviteMembership: async () => null, acceptCollectionInvite: async () => null, createTagAssignment: async (value) => value, setCollectionCoverImage: async () => null, createGlobalShare: async (value, _owner, replay) => ({ share: value, ...replay }), getActiveGlobalShareByTokenHash: async () => null, getTag: async () => null, ...overrides };
}
const requestFingerprint = (value: string) => mediaLibraryRequestFingerprint(value, Buffer.alloc(32, 9));
describe('MediaLibrary service boundaries', () => {
  test('strictly rejects unknown fields', async () => { await expect(createMediaLibraryService({ repository: repository() }).leaveCollection({ scopeKey: newId(), collectionKey: newId(), actorKey: newId(), forged: true })).rejects.toThrow(); });
  test('returns one-time tokens while removing persisted hashes', async () => {
    const replay = { encryptReplay: JSON.stringify, decryptReplay: JSON.parse, requestFingerprint };
    const service = createMediaLibraryService({ repository: repository(), token: () => 'one-time-mediaLibrary-token-that-is-long-enough', hashPassword: async () => 'scrypt:long-enough-password-hash', ...replay });
    const invite = await service.createCollectionInvite({ scopeKey: newId(), collectionKey: newId(), invitedByKey: newId(), inviteeKey: newId(), expiresAt: later, now, idempotencyKey: 'invite-1' });
    const share = await service.createGlobalShare({ scopeKey: newId(), sourceType: 'collection', sourceKey: newId(), ownerKey: newId(), password: 'secret', now, idempotencyKey: 'share-1' });
    expect(invite.invite).not.toHaveProperty('tokenHash'); expect(share.share).not.toHaveProperty('tokenHash'); expect(share.share).not.toHaveProperty('passwordHash');
  });
  test('enforces ownership and future expiry', async () => {
    const service = createMediaLibraryService({ repository: repository({ ownsCollection: async () => false, createGlobalShare: async () => null }) });
    await expect(service.createCollectionInvite({ scopeKey: newId(), collectionKey: newId(), invitedByKey: newId(), inviteeKey: newId(), expiresAt: later, now, idempotencyKey: 'invite-2' })).rejects.toThrow('ownership');
    await expect(service.createGlobalShare({ scopeKey: newId(), sourceType: 'collection', sourceKey: newId(), ownerKey: newId(), expiresAt: now, now, idempotencyKey: 'share-2' })).rejects.toThrow('future');
  });
  test('verifies protected active shares without exposing hashes', async () => {
    const passwordHash = await hashMediaLibrarySharePassword('correct password');
    expect(await verifyMediaLibrarySharePassword('correct password', passwordHash)).toBe(true);
    expect(await verifyMediaLibrarySharePassword('wrong password', passwordHash)).toBe(false);
    const active = { key: newId(), scopeKey: newId(), sourceType: 'image' as const, sourceKey: newId(), permission: 'read' as const, tokenHash: 'a'.repeat(64), passwordHash, deletedAt: null, createdAt: now, updatedAt: now };
    const service = createMediaLibraryService({ repository: repository({ getActiveGlobalShareByTokenHash: async () => active }) });
    await expect(service.accessGlobalShare({ token: 'a'.repeat(32), password: 'wrong password', at: now })).rejects.toThrow('unavailable');
    const result = await service.accessGlobalShare({ token: 'a'.repeat(32), password: 'correct password', at: now });
    expect(result.share).not.toHaveProperty('tokenHash');
    expect(result.share).not.toHaveProperty('passwordHash');
    await expect(service.accessGlobalShare({ token: 'a'.repeat(32), password: 'correct password', at: now, extra: true })).rejects.toThrow();
  });

  test('replays token creates by idempotency key and rejects changed payloads', async () => {
    const invites = new Map<string, any>();
    const shares = new Map<string, any>();
    const repo = repository({
      async createCollectionInvite(value, replay) { const existing = invites.get(value.key); if (existing) return existing; const saved = { invite: value, ...replay }; invites.set(value.key, saved); return saved; },
      async createGlobalShare(value, _owner, replay) { const existing = shares.get(value.key); if (existing) return existing; const saved = { share: value, ...replay }; shares.set(value.key, saved); return saved; },
    });
    let sequence = 0;
    const service = createMediaLibraryService({ repository: repo, token: () => `token-${String(++sequence).padStart(32, '0')}`, encryptReplay: JSON.stringify, decryptReplay: JSON.parse, hashPassword: async () => 'scrypt:long-enough-password-hash', requestFingerprint });
    const scopeKey = newId(), actorKey = newId(), collectionKey = newId(), recipientKey = newId();
    const inviteInput = { scopeKey, collectionKey, invitedByKey: actorKey, inviteeKey: recipientKey, expiresAt: later, now, idempotencyKey: 'same-invite' };
    const firstInvite = await service.createCollectionInvite(inviteInput);
    expect(await service.createCollectionInvite(inviteInput)).toEqual(firstInvite);
    await expect(service.createCollectionInvite({ ...inviteInput, inviteeKey: newId() })).rejects.toThrow('different invite');
    const shareInput = { scopeKey, sourceType: 'collection' as const, sourceKey: collectionKey, ownerKey: actorKey, password: 'secret', now, idempotencyKey: 'same-share' };
    const firstShare = await service.createGlobalShare(shareInput);
    expect(await service.createGlobalShare(shareInput)).toEqual(firstShare);
    await expect(service.createGlobalShare({ ...shareInput, permission: 'comment' as const })).rejects.toThrow('different share');
    await expect(service.createGlobalShare({ ...shareInput, password: 'different secret' })).rejects.toThrow('different share');
    const storedRequestHash = shares.values().next().value.requestHash as string;
    expect(storedRequestHash).not.toBe(createHash('sha256').update('secret').digest('hex'));
    expect(storedRequestHash).not.toContain('secret');
  });

  test('returns an existing accepted membership without accepting twice', async () => {
    const membership = { key: newId(), scopeKey: newId(), collectionKey: newId(), memberKey: newId(), role: 'member' as const, createdAt: now };
    let acceptanceCalls = 0;
    const service = createMediaLibraryService({ repository: repository({ getAcceptedCollectionInviteMembership: async () => membership, acceptCollectionInvite: async () => { acceptanceCalls += 1; return null; } }) });
    expect(await service.acceptCollectionInvite({ token: 'x'.repeat(32), recipientKey: membership.memberKey, now })).toEqual(membership);
    expect(acceptanceCalls).toBe(0);
  });

  test('requires source image access before add, copy, or move', async () => {
    let mutations = 0;
    const service = createMediaLibraryService({ repository: repository({ canAccessImage: async () => false, addImageToCollection: async (value) => { mutations += 1; return value; }, copyImageToCollection: async (value) => { mutations += 1; return value; }, moveImageBetweenCollections: async (_source, value) => { mutations += 1; return value; } }) });
    const input = { scopeKey: newId(), collectionKey: newId(), imageKey: newId(), actorKey: newId(), now };
    await expect(service.addImageToCollection(input)).rejects.toThrow('Source image access');
    await expect(service.copyImageToCollection(input)).rejects.toThrow('Source image access');
    await expect(service.moveImageBetweenCollections({ ...input, sourceCollectionKey: newId() })).rejects.toThrow('Source image access');
    expect(mutations).toBe(0);
  });

  test('revalidates current ownership before replaying invite or share secrets', async () => {
    let ownsCollection = true, ownsImage = true, decryptions = 0;
    const invites = new Map<string, any>(), shares = new Map<string, any>();
    const repo = repository({
      ownsCollection: async () => ownsCollection,
      ownsImage: async () => ownsImage,
      async createCollectionInvite(value, replay) { const saved = invites.get(value.key) ?? { invite: value, ...replay }; invites.set(value.key, saved); return saved; },
      async createGlobalShare(value, _owner, replay) { const saved = shares.get(value.key) ?? { share: value, ...replay }; shares.set(value.key, saved); return saved; },
    });
    const service = createMediaLibraryService({ repository: repo, token: () => 'replay-token-that-is-at-least-thirty-two-characters', encryptReplay: JSON.stringify, decryptReplay: (value) => { decryptions += 1; return JSON.parse(value); }, requestFingerprint });
    const scopeKey = newId(), ownerKey = newId();
    const inviteInput = { scopeKey, collectionKey: newId(), invitedByKey: ownerKey, inviteeKey: newId(), expiresAt: later, now, idempotencyKey: 'revoked-invite' };
    await service.createCollectionInvite(inviteInput);
    ownsCollection = false;
    await expect(service.createCollectionInvite(inviteInput)).rejects.toThrow('ownership');
    const shareInput = { scopeKey, sourceType: 'image' as const, sourceKey: newId(), ownerKey, now, idempotencyKey: 'revoked-share' };
    await service.createGlobalShare(shareInput);
    ownsImage = false;
    await expect(service.createGlobalShare(shareInput)).rejects.toThrow('ownership');
    expect(decryptions).toBe(2);
  });
});
