import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createEmailOAuthService, type OAuthStore } from './oauth';
import { organizationConnectorSchema } from './connector-schema';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { EmailWatchRepairPendingError } from './service';

const previousClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const previousClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const values = new Map<string, string>();
const store: OAuthStore = {
  async put(key, value) { if (values.has(key)) return false; values.set(key, value); return true; },
  async take(key) { const value = values.get(key) ?? null; values.delete(key); return value; },
};
const userKey = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';

beforeEach(() => {
  values.clear();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
});
afterEach(() => {
  if (previousClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
  if (previousClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousClientSecret;
});

describe('email OAuth state', () => {
  test('binds state to access context and consumes denial callbacks once', async () => {
    const oauth = createEmailOAuthService({ store, authorize: async () => ({ membershipKey: scopeKey }), connectors: {} as never });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const authorization = new URL(started.authorizationUrl);
    const state = authorization.searchParams.get('state')!;
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    expect(await oauth.callback({ state, error: 'access_denied' })).toBe('vorinthexcore://capability/signal?email_connection_error=access_denied');
    await expect(oauth.callback({ state, error: 'access_denied' })).rejects.toThrow('invalid or expired');
  });

  test('rejects unregistered mobile return URIs', async () => {
    const oauth = createEmailOAuthService({ store, authorize: async () => ({ membershipKey: scopeKey }), connectors: {} as never });
    await expect(oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'https://attacker.example/callback' })).rejects.toThrow('not allowed');
  });

  test('exchanges a successful callback for one identity-bound grant', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const connector = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-1', email: 'person@example.com',
      encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    const stateWrites: unknown[][] = [];
    let watchWrites = 0;
    const connectors = {
      findExact: async () => null,
      upsert: async () => ({ ...connector, revision: 'connector-upsert' }),
      getByKey: async () => connector,
      setSyncState: async (...input: unknown[]) => { stateWrites.push(input); return true; },
      activateInitialization: async () => ({ ...connector, revision: 'connector-active' }),
      updateWatch: async () => { watchWrites += 1; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history-1' }),
      ensureInbox: async (_actor, _connector, metadata, overwrite) => { expect(metadata).toEqual({ name: 'Work' }); expect(overwrite).toBe(false); },
      inboxView: async () => ({ key: scopeKey, connectorKey: connector.key, name: 'Work', email: connector.email }),
      subscribe: async (actor, connectorKey) => { expect(actor).toEqual({ userKey, organizationKey: 'org-1', scopeKey }); expect(connectorKey).toBe(connector.key); watchWrites += 1; },
      exchange: async () => ({ identity: { providerAccountId: 'google-1', email: 'person@example.com' }, scopes: ['email'], credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    const code = redirect.searchParams.get('email_connection_code')!;
    expect(stateWrites).toHaveLength(1);
    expect(stateWrites[0]?.[2]).toMatchObject({ historyId: 'history-1', pendingHistoryId: null, pendingThreadIds: null, resetLastSynced: true, markSynced: false, expectedRevision: 'connector-upsert' });
    expect(watchWrites).toBe(1);
    expect(await oauth.exchange({ userKey, organizationKey: 'org-1', scopeKey, code })).toMatchObject({ email: 'person@example.com' });
    expect(await oauth.exchange({ userKey, organizationKey: 'org-1', scopeKey, code })).toBeNull();
  });

  test('does not issue a grant when watch setup, configuration, or durable repair enqueue fails', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const connector = organizationConnectorSchema.parse({ key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-watch-failure', email: 'person@example.com', encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey, status: 'active', createdAt: now, updatedAt: now });
    for (const failure of ['GMAIL_PUBSUB_TOPIC is not configured', 'watch repair queue unavailable', 'watch rejected']) {
      let rollback = 0;
      const oauth = createEmailOAuthService({
        store,
        connectors: { findExact: async () => null, upsert: async () => ({ ...connector, revision: 'upsert' }), setSyncState: async () => 'sync', activateInitialization: async () => ({ ...connector, revision: 'active' }), rollbackReconnect: async () => { rollback += 1; return true; } } as never,
        inboxes: {} as never,
        authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), ensureInbox: async () => ({ revision: 'inbox' }),
        subscribe: async () => { throw new Error(failure); },
        exchange: async () => ({ identity: { providerAccountId: connector.providerAccountId, email: connector.email }, scopes: ['email'], credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
      });
      const state = new URL((await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' })).authorizationUrl).searchParams.get('state')!;
      const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
      expect(redirect.searchParams.get('email_connection_code')).toBeNull();
      expect(redirect.searchParams.get('email_connection_error')).toBe('connection_failed');
      expect(rollback).toBe(1);
      expect([...values.keys()].some((key) => key.startsWith('email:oauth:grant:'))).toBe(false);
    }
  });

  test('issues a grant when watch fails only after a durable repair intent is confirmed', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const connector = organizationConnectorSchema.parse({ key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-watch-repair', email: 'person@example.com', encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey, status: 'active', createdAt: now, updatedAt: now });
    const oauth = createEmailOAuthService({
      store,
      connectors: { findExact: async () => connector, credentials: () => ({ accessToken: 'old', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now }), upsert: async () => ({ ...connector, revision: 'upsert' }), setSyncState: async () => 'sync', getByKey: async () => connector } as never,
      inboxes: { getByConnector: async () => null } as never,
      authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), ensureInbox: async () => ({ revision: 'inbox' }), inboxView: async () => ({ connectorKey: connector.key }),
      subscribe: async () => { throw new EmailWatchRepairPendingError(new Error('watch rejected')); },
      exchange: async () => ({ identity: { providerAccountId: connector.providerAccountId, email: connector.email }, scopes: ['email'], credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const state = new URL((await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' })).authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    const code = redirect.searchParams.get('email_connection_code');
    expect(code).toStartWith('vrtx_email_grant_');
    expect(await oauth.exchange({ userKey, organizationKey: 'org-1', scopeKey, code: code! })).toEqual({ connectorKey: connector.key });
  });

  test('recovers refresh tokens only from the exact provider account', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const previous = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-2', email: 'second@example.com',
      encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    let upserted: any;
    const connectors = {
      findExact: async (organizationKey: string, selectedScopeKey: string, providerAccountId: string) => {
        expect({ organizationKey, selectedScopeKey, providerAccountId }).toEqual({ organizationKey: 'org-1', selectedScopeKey: scopeKey, providerAccountId: 'google-2' });
        return previous;
      },
      credentials: () => ({ accessToken: 'old-access', refreshToken: 'exact-refresh', tokenType: 'Bearer', expiresAt: now }),
      upsert: async (input: unknown) => { upserted = input; return previous; },
      setSyncState: async () => true,
      getByKey: async () => previous,
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, inboxes: { getByConnector: async () => null } as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history-2' }), subscribe: async () => undefined,
      ensureInbox: async (_actor, _connector, metadata, overwrite) => { expect(metadata).toEqual({ name: 'Work' }); expect(overwrite).toBe(true); },
      exchange: async () => ({ identity: { providerAccountId: 'google-2', email: 'second@example.com' }, scopes: ['email'], credentials: { accessToken: 'new-access', refreshToken: undefined, tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    expect(redirect.searchParams.get('email_connection_code')).toStartWith('vrtx_email_grant_');
    expect(upserted).toMatchObject({ providerAccountId: 'google-2', credentials: { accessToken: 'new-access', refreshToken: 'exact-refresh' } });
  });

  test('never decrypts revoked credentials when Google omits a refresh token', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const revoked = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-revoked', email: 'revoked@example.com',
      encryptedCredentials: 'revoked', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'revoked', revokedAt: now, createdAt: now, updatedAt: now,
    });
    let decrypted = false;
    let upserted = false;
    const connectors = {
      findExact: async () => revoked,
      credentials: () => { decrypted = true; throw new Error('must not decrypt'); },
      upsert: async () => { upserted = true; return revoked; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, inboxes: { getByConnector: async () => null } as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), subscribe: async () => undefined,
      exchange: async () => ({ identity: { providerAccountId: 'google-revoked', email: 'revoked@example.com' }, scopes: ['email'], credentials: { accessToken: 'new-access', refreshToken: undefined, tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    expect(redirect.searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(decrypted).toBe(false);
    expect(upserted).toBe(false);
  });

  test('revokes only a newly initialized binding after inbox initialization fails and keeps state one-time', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const pending = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-new', email: 'new@example.com',
      encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'error', syncEnabled: false, lastError: 'initializing', createdAt: now, updatedAt: now,
    });
    let rollback: any;
    const connectors = {
      findExact: async () => null,
      upsert: async (input: any) => { expect(input.initializeInactive).toBe(true); return { ...pending, revision: 'connector-upsert' }; },
      rollbackReconnect: async (input: unknown) => { rollback = input; return true; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, inboxes: { getByConnector: async () => null, restoreAfterReconnectFailure: async () => true } as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }),
      ensureInbox: async () => { throw new Error('metadata failed'); },
      exchange: async () => ({ identity: { providerAccountId: 'google-new', email: 'new@example.com' }, scopes: ['email'], credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(rollback).toMatchObject({ connectorKey: pending.key, connectorRevision: 'connector-upsert', previousConnector: null, previousInbox: null });
    await expect(oauth.callback({ state, code: 'provider-code' })).rejects.toThrow('invalid or expired');
  });

  test('does not revoke an existing healthy binding when inbox metadata initialization fails', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const healthy = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-existing', email: 'existing@example.com',
      encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    let rollback: any;
    const connectors = {
      findExact: async () => healthy,
      credentials: () => ({ accessToken: 'old', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now }),
      upsert: async (input: any) => { expect(input.initializeInactive).toBe(false); return { ...healthy, revision: 'connector-upsert' }; },
      rollbackReconnect: async (input: unknown) => { rollback = input; return true; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, inboxes: { getByConnector: async () => null, restoreAfterReconnectFailure: async () => true } as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }),
      ensureInbox: async () => { throw new Error('metadata failed'); },
      exchange: async () => ({ identity: { providerAccountId: 'google-existing', email: 'existing@example.com' }, scopes: ['email'], credentials: { accessToken: 'new', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(rollback).toMatchObject({ connectorKey: healthy.key, connectorRevision: 'connector-upsert', previousConnector: healthy, previousInbox: null });
  });

  test('fails reconnect safely when inbox metadata changed after the pre-upsert snapshot', async () => {
    const now = '2026-08-11T12:00:00.000Z';
    const previous = organizationConnectorSchema.parse({ key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-inbox-race', email: 'race@example.com', encryptedCredentials: 'old', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey, status: 'active', createdAt: now, updatedAt: now });
    const previousInbox = { key: scopeKey, organizationKey: 'org-1', scopeKey, connectorKey: previous.key, name: 'Before OAuth', isFavorite: false, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now, revision: 'inbox-snapshot' };
    let expectedInboxRevision: string | null | undefined, rollback: any;
    const connectors = {
      findExact: async () => ({ ...previous, revision: 'connector-snapshot' }), credentials: () => ({ accessToken: 'old', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now }),
      upsert: async () => ({ ...previous, revision: 'callback-upsert' }), rollbackReconnect: async (input: any) => { rollback = input; return true; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, inboxes: { getByConnector: async () => previousInbox } as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }),
      ensureInbox: async (_actor, _connector, _metadata, _overwrite, expectedRevision) => { expectedInboxRevision = expectedRevision; throw new Error('inbox revision conflict'); },
      exchange: async () => ({ identity: { providerAccountId: previous.providerAccountId, email: previous.email }, scopes: ['email'], credentials: { accessToken: 'new', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const state = new URL((await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Replacement', returnUri: 'vorinthexcore://capability/signal' })).authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(expectedInboxRevision).toBe('inbox-snapshot');
    expect(rollback).toMatchObject({ connectorRevision: 'callback-upsert', previousInbox, inboxRevision: undefined });
  });

  test.each(['sync', 'grant'] as const)('restores the complete healthy connector and inbox after %s initialization failure', async (failureStage) => {
    const now = '2026-08-11T12:00:00.000Z';
    const previous = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-existing', email: 'existing@example.com',
      encryptedCredentials: 'old-ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'active', historyId: 'old-history', watchRegisteredAt: now, watchExpiresAt: '2026-08-12T12:00:00.000Z', lastSyncedAt: now, createdAt: now, updatedAt: now,
    });
    const reconnected = organizationConnectorSchema.parse({ ...previous, encryptedCredentials: 'new-ciphertext', accessTokenFingerprint: 'b'.repeat(64), historyId: undefined, watchRegisteredAt: undefined, watchExpiresAt: undefined, lastSyncedAt: undefined, updatedAt: '2026-08-11T12:01:00.000Z' });
    const previousInbox = { key: scopeKey, organizationKey: 'org-1', scopeKey, connectorKey: previous.key, name: 'Original', description: 'Keep me', coverImageKey: userKey, isFavorite: true, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now };
    let rollback: any;
    const failingStore: OAuthStore = {
      async put(key, value, ttl) { if (failureStage === 'grant' && key.startsWith('email:oauth:grant:')) return false; return store.put(key, value, ttl); },
      take: store.take,
    };
    const connectors = {
      findExact: async () => previous,
      credentials: () => ({ accessToken: 'old', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now }),
      upsert: async () => ({ ...reconnected, revision: 'connector-upsert' }),
      setSyncState: async () => failureStage === 'sync' ? null : 'connector-sync',
      rollbackReconnect: async (input: unknown) => { rollback = input; return true; },
    };
    const inboxes = {
      getByConnector: async () => previousInbox,
    };
    const oauth = createEmailOAuthService({
      store: failingStore, connectors: connectors as never, inboxes: inboxes as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'new-history' }), subscribe: async () => undefined,
      ensureInbox: async () => ({ revision: 'inbox-write' }),
      exchange: async () => ({ identity: { providerAccountId: previous.providerAccountId, email: previous.email }, scopes: ['email'], credentials: { accessToken: 'new', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Replacement', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(rollback).toMatchObject({ connectorKey: reconnected.key, connectorRevision: failureStage === 'sync' ? 'connector-upsert' : 'connector-sync', inboxRevision: 'inbox-write', previousConnector: previous, previousInbox });
    await expect(oauth.callback({ state, code: 'provider-code' })).rejects.toThrow('invalid or expired');
  });

  test.each(['sync', 'activation', 'grant'] as const)('revokes and removes a new connector after %s initialization failure', async (failureStage) => {
    const now = '2026-08-11T12:00:00.000Z';
    const pending = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-new-stage', email: 'new@example.com', encryptedCredentials: 'ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'c'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'error', syncEnabled: false, lastError: 'initializing', createdAt: now, updatedAt: now,
    });
    const active = organizationConnectorSchema.parse({ ...pending, status: 'active', syncEnabled: true, lastError: undefined, updatedAt: '2026-08-11T12:01:00.000Z' });
    let rollback: any;
    const failingStore: OAuthStore = {
      async put(key, value, ttl) { if (failureStage === 'grant' && key.startsWith('email:oauth:grant:')) return false; return store.put(key, value, ttl); },
      take: store.take,
    };
    const connectors = {
      findExact: async () => null,
      upsert: async () => ({ ...pending, revision: 'connector-upsert' }),
      setSyncState: async () => failureStage === 'sync' ? null : 'connector-sync',
      activateInitialization: async () => failureStage === 'activation' ? null : { ...active, revision: 'connector-active' },
      rollbackReconnect: async (input: unknown) => { rollback = input; return true; },
    };
    const oauth = createEmailOAuthService({
      store: failingStore, connectors: connectors as never, inboxes: {} as never,
      authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), subscribe: async () => undefined, ensureInbox: async () => ({ revision: 'inbox-write' }),
      exchange: async () => ({ identity: { providerAccountId: pending.providerAccountId, email: pending.email }, scopes: ['email'], credentials: { accessToken: 'new', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Work', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    const expectedRevision = failureStage === 'sync' ? 'connector-upsert' : failureStage === 'activation' ? 'connector-sync' : 'connector-active';
    expect(rollback).toMatchObject({ connectorKey: pending.key, connectorRevision: expectedRevision, inboxRevision: 'inbox-write', previousConnector: null, previousInbox: null });
  });

  test.each(['sync', 'credentials', 'status', 'inbox'] as const)('preserves a concurrent %s edit when reconnect fails after upsert', async (concurrentEdit) => {
    const now = '2026-08-11T12:00:00.000Z';
    const previous = organizationConnectorSchema.parse({
      key: userKey, organizationKey: 'org-1', scopeKey, provider: 'gmail', providerAccountId: 'google-concurrent', email: 'person@example.com',
      encryptedCredentials: 'old-ciphertext', encryptionKeyId: 'v1', accessTokenFingerprint: 'a'.repeat(64), scopes: ['email'], createdByMembershipKey: scopeKey,
      status: 'active', createdAt: now, updatedAt: now,
    });
    const reconnected = { ...previous, encryptedCredentials: 'callback-ciphertext', accessTokenFingerprint: 'b'.repeat(64), revision: 'callback-upsert' };
    const previousInbox = { key: scopeKey, organizationKey: 'org-1', scopeKey, connectorKey: previous.key, name: 'Original', isFavorite: false, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now, revision: 'inbox-before' };
    let connectorRevision = 'callback-sync';
    let inboxRevision = 'callback-inbox';
    let concurrentValue = '';
    let restored = false;
    const failingStore: OAuthStore = { async put(key, value, ttl) { if (key.startsWith('email:oauth:grant:')) return false; return store.put(key, value, ttl); }, take: store.take };
    const connectors = {
      findExact: async () => previous,
      credentials: () => ({ accessToken: 'old', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now }),
      upsert: async () => reconnected,
      setSyncState: async (_key: string, _status: string, input: any) => {
        expect(input.expectedRevision).toBe('callback-upsert');
        if (concurrentEdit !== 'inbox') { connectorRevision = `concurrent-${concurrentEdit}`; concurrentValue = concurrentEdit; return null; }
        return 'callback-sync';
      },
      rollbackReconnect: async (input: any) => {
        const matches = input.connectorRevision === connectorRevision && input.inboxRevision === inboxRevision;
        if (matches) restored = true;
        return matches;
      },
    };
    const oauth = createEmailOAuthService({
      store: failingStore, connectors: connectors as never, inboxes: { getByConnector: async () => previousInbox } as never,
      authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), subscribe: async () => undefined,
      ensureInbox: async (_actor, _connector, _metadata, _overwrite, expectedRevision) => {
        expect(expectedRevision).toBe('inbox-before');
        if (concurrentEdit === 'inbox') { inboxRevision = 'concurrent-inbox'; concurrentValue = 'inbox'; throw new Error('inbox conflict'); }
        return { revision: 'callback-inbox' };
      },
      exchange: async () => ({ identity: { providerAccountId: previous.providerAccountId, email: previous.email }, scopes: ['email'], credentials: { accessToken: 'new', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, name: 'Replacement', returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(new URL(await oauth.callback({ state, code: 'provider-code' })).searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(restored).toBe(false);
    expect(concurrentValue).toBe(concurrentEdit);
  });
});
