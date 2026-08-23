import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createEmailOAuthService, type OAuthStore } from './oauth';
import { organizationConnectorSchema } from './connector-schema';

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
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, returnUri: 'vorinthexcore://capability/signal' });
    const authorization = new URL(started.authorizationUrl);
    const state = authorization.searchParams.get('state')!;
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    expect(await oauth.callback({ state, error: 'access_denied' })).toBe('vorinthexcore://capability/signal?email_connection_error=access_denied');
    await expect(oauth.callback({ state, error: 'access_denied' })).rejects.toThrow('invalid or expired');
  });

  test('rejects unregistered mobile return URIs', async () => {
    const oauth = createEmailOAuthService({ store, authorize: async () => ({ membershipKey: scopeKey }), connectors: {} as never });
    await expect(oauth.start({ userKey, organizationKey: 'org-1', scopeKey, returnUri: 'https://attacker.example/callback' })).rejects.toThrow('not allowed');
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
      upsert: async () => connector,
      getByKey: async () => connector,
      setSyncState: async (...input: unknown[]) => { stateWrites.push(input); },
      updateWatch: async () => { watchWrites += 1; },
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history-1' }),
      subscribe: async (actor, connectorKey) => { expect(actor).toEqual({ userKey, organizationKey: 'org-1', scopeKey }); expect(connectorKey).toBe(connector.key); watchWrites += 1; },
      exchange: async () => ({ identity: { providerAccountId: 'google-1', email: 'person@example.com' }, scopes: ['email'], credentials: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    const code = redirect.searchParams.get('email_connection_code')!;
    expect(stateWrites).toHaveLength(1);
    expect(stateWrites[0]?.[2]).toMatchObject({ historyId: 'history-1', pendingHistoryId: null, pendingThreadIds: null, resetLastSynced: true, markSynced: false });
    expect(watchWrites).toBe(1);
    expect(await oauth.exchange({ userKey, organizationKey: 'org-1', scopeKey, code })).toMatchObject({ email: 'person@example.com' });
    expect(await oauth.exchange({ userKey, organizationKey: 'org-1', scopeKey, code })).toBeNull();
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
      setSyncState: async () => undefined,
      getByKey: async () => previous,
    };
    const oauth = createEmailOAuthService({
      store, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history-2' }), subscribe: async () => undefined,
      exchange: async () => ({ identity: { providerAccountId: 'google-2', email: 'second@example.com' }, scopes: ['email'], credentials: { accessToken: 'new-access', refreshToken: undefined, tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, returnUri: 'vorinthexcore://capability/signal' });
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
      store, connectors: connectors as never, authorize: async () => ({ membershipKey: scopeKey }), profile: async () => ({ historyId: 'history' }), subscribe: async () => undefined,
      exchange: async () => ({ identity: { providerAccountId: 'google-revoked', email: 'revoked@example.com' }, scopes: ['email'], credentials: { accessToken: 'new-access', refreshToken: undefined, tokenType: 'Bearer', expiresAt: now } }),
    });
    const started = await oauth.start({ userKey, organizationKey: 'org-1', scopeKey, returnUri: 'vorinthexcore://capability/signal' });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const redirect = new URL(await oauth.callback({ state, code: 'provider-code' }));
    expect(redirect.searchParams.get('email_connection_error')).toBe('connection_failed');
    expect(decrypted).toBe(false);
    expect(upserted).toBe(false);
  });
});
