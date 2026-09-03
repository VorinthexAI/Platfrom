import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createCompleteAccountAvatarHandler, createUpdateAccountProfileHandler } from './account-profile';

describe('account profile HTTP API', () => {
  test('requires a user and rejects unknown fields', async () => {
    const unauthenticated = new Hono().patch('/profile', createUpdateAccountProfileHandler({ getIdentity: async () => null }));
    expect((await unauthenticated.request('/profile', { method: 'PATCH' })).status).toBe(401);

    const userKey = newId();
    const app = new Hono().patch('/profile', createUpdateAccountProfileHandler({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      service: { updateName: async () => { throw new Error('must not execute'); } },
    }));
    const response = await app.request('/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ada', userKey }) });
    expect(response.status).toBe(400);
  });

  test('passes only the authenticated user key to the canonical service', async () => {
    const userKey = newId();
    const calls: unknown[][] = [];
    const app = new Hono().patch('/profile', createUpdateAccountProfileHandler({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      service: { updateName: async (...args) => {
        calls.push(args);
        return { profile: { key: userKey, name: 'Ada Lovelace', profileStorageKey: null, updatedAt: '2026-09-03T10:00:00.000Z' } };
      } },
    }));
    const response = await app.request('/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '  Ada Lovelace  ' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { profile: { name: 'Ada Lovelace', avatarUrl: null } } });
    expect(calls).toEqual([[{ name: 'Ada Lovelace' }, userKey]]);
  });

  test('returns committed name and avatar mutations when read URL signing fails', async () => {
    const userKey = newId();
    const storageKey = `profiles/${userKey}/${newId()}.png`;
    const signer = async () => { throw new Error('signer unavailable'); };
    const profile = new Hono().patch('/profile', createUpdateAccountProfileHandler({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      service: { updateName: async () => ({ profile: { key: userKey, name: 'Ada', profileStorageKey: storageKey, updatedAt: '2026-09-03T10:00:00.000Z' } }) },
      signAvatar: signer,
    }));
    const profileResponse = await profile.request('/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ada' }) });
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toEqual({ success: true, data: { profile: { name: 'Ada', avatarUrl: null } } });

    const complete = new Hono().post('/avatar/complete', createCompleteAccountAvatarHandler({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      complete: async () => ({
        profile: { key: userKey, name: 'Ada', profileStorageKey: storageKey, updatedAt: '2026-09-03T10:00:00.000Z' },
        previousStorageKey: null,
        avatar: { mimeType: 'image/png', sizeBytes: 10, width: 2, height: 2 },
      }),
      signAvatar: signer,
    }));
    const completeResponse = await complete.request('/avatar/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadKey: newId() }) });
    expect(completeResponse.status).toBe(200);
    expect(await completeResponse.json()).toMatchObject({ success: true, data: { profile: { name: 'Ada', avatarUrl: null } } });
  });
});
