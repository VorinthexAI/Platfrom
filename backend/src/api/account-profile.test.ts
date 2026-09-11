import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { APP_KEYS } from '@/lib/apps/registry';
import { runWithEventApp } from '@/lib/ai/events/runtime';
import { createCompleteAccountAvatarHandler, createProfileBadgeHandlers, createUpdateAccountProfileHandler } from './account-profile';

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

  test('routes badge generation and claim through the same canonical service with trusted identity', async () => {
    const userKey = newId();
    const scopeKey = newId();
    const teamKey = 'team-1';
    const candidateKey = newId();
    const appScopeKey = newId();
    const calls: unknown[][] = [];
    const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey, name: 'Ada' }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as any;
    const recordEvent = async (...args: unknown[]) => { calls.push(['event', ...args]); };
    const handlers = createProfileBadgeHandlers({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async (selectors) => { calls.push(['authorize', selectors]); return { context }; },
      service: {
        generate: async (...args) => { calls.push(['generate', ...args]); return { candidateKey, avatarUrl: 'https://example.com/candidate.png', expiresAt: '2026-09-09T10:10:00.000Z' }; },
        claim: (async (...args: unknown[]) => { calls.push(['claim', ...args]); return { profile: { name: 'Ada', profileStorageKey: `profiles/${userKey}/${candidateKey}.png` } }; }) as any,
      },
      recordEvent,
      billing: {
        charge: async () => ({ status: 'applied', transaction: { key: newId(), eventKey: newId() }, claimOwner: 'owner-1' }) as any,
        complete: async () => true,
        renew: async () => true,
      },
      signAvatar: async () => 'https://example.com/profile.png',
    });
    const app = new Hono()
      .post('/badge', (c) => runWithEventApp(APP_KEYS.CORE, appScopeKey, () => handlers.generate(c), recordEvent))
      .post('/badge/claim', (c) => runWithEventApp(APP_KEYS.CORE, appScopeKey, () => handlers.claim(c), recordEvent));

    const generate = await app.request('/badge', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'badge-request-1' }, body: JSON.stringify({ teamKey, scopeKey }) });
    expect(generate.status).toBe(201);
    expect(await generate.json()).toMatchObject({ success: true, data: { candidateKey } });
    const claim = await app.request('/badge/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, candidateKey }) });
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ success: true, data: { profile: { name: 'Ada', avatarUrl: 'https://example.com/profile.png' } } });
    expect(calls).toContainEqual(['generate', {}, context, 'badge-request-1']);
    expect(calls).toContainEqual(['claim', { candidateKey }, userKey]);
    expect(calls.filter(([kind]) => kind === 'authorize')).toEqual([['authorize', { teamKey, scopeKey }], ['authorize', { teamKey, scopeKey }]]);
  });
});
