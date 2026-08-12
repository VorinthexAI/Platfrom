import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireOrganizationAccess, requireScopeAccess } from '@/lib/founders/access';
import { redisConnection } from '@/lib/redis';
import { connectorPublic, createConnectorRepository, type ConnectorRepository } from './connector-repository';
import { createEmailRepository, type EmailRepository } from './repository';
import { buildGmailAuthorizationUrl, createGmailClient, createPkce, exchangeGmailCode } from './gmail';

const STATE_PREFIX = 'email:oauth:state:';
const GRANT_PREFIX = 'email:oauth:grant:';
const stateSchema = z.object({
  userKey: z.string().cuid(), organizationKey: z.string().min(1), scopeKey: z.string().cuid(), membershipKey: z.string().cuid(),
  returnUri: z.string().url(), verifier: z.string().min(43), nonce: z.string().min(20),
}).strict();
const grantSchema = z.object({
  userKey: z.string().cuid(), organizationKey: z.string().min(1), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(), email: z.string().email(),
}).strict();

export interface OAuthStore {
  put(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  take(key: string): Promise<string | null>;
}

const redisStore: OAuthStore = {
  async put(key, value, ttlSeconds) { return (await redisConnection.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK'; },
  take(key) { return redisConnection.getdel(key); },
};

function token(prefix: string) { return `${prefix}${randomBytes(32).toString('base64url')}`; }
function allowedReturnUri(value: string) {
  const allowed = new Set((process.env.EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS ?? 'vorinthexcore://capability/signal').split(',').map((item) => item.trim()).filter(Boolean));
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  if (!allowed.has(url.toString())) throw new Error('Email connector return URI is not allowed');
  return url.toString();
}

export function createEmailOAuthService(options: {
  store?: OAuthStore; connectors?: ConnectorRepository; repository?: EmailRepository;
  exchange?: typeof exchangeGmailCode; authorize?: (userKey: string, organizationKey: string, scopeKey: string) => Promise<{ membershipKey: string }>;
  profile?: (accessToken: string) => Promise<{ historyId: string }>;
  watch?: (accessToken: string) => Promise<{ historyId: string; expiration: string } | null>;
} = {}) {
  const store = options.store ?? redisStore;
  const connectors = options.connectors ?? createConnectorRepository();
  const repository = options.repository ?? createEmailRepository();
  const exchange = options.exchange ?? exchangeGmailCode;
  const profile = options.profile ?? ((accessToken: string) => createGmailClient(accessToken).profile());
  const registerWatch = options.watch ?? (async (accessToken: string) => {
    const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
    return topic ? createGmailClient(accessToken).watch(topic) : null;
  });
  const authorize = options.authorize ?? (async (userKey, organizationKey, scopeKey) => {
    const { membership } = await requireOrganizationAccess(userKey, organizationKey);
    await requireScopeAccess(membership, scopeKey);
    if (membership.orgRole !== 'owner' && membership.orgRole !== 'admin') throw new Error('Owner or admin role is required to connect email');
    return { membershipKey: membership.key };
  });
  return {
    async start(input: { userKey: string; organizationKey: string; scopeKey: string; returnUri: string }) {
      const access = await authorize(input.userKey, input.organizationKey, input.scopeKey);
      const state = token('vrtx_email_state_');
      const nonce = randomBytes(24).toString('base64url');
      const pkce = createPkce();
      const record = stateSchema.parse({ ...input, membershipKey: access.membershipKey, returnUri: allowedReturnUri(input.returnUri), verifier: pkce.verifier, nonce });
      if (!(await store.put(`${STATE_PREFIX}${state}`, JSON.stringify(record), 600))) throw new Error('Could not create email authorization state');
      return { authorizationUrl: buildGmailAuthorizationUrl({ state, nonce, codeChallenge: pkce.challenge }) };
    },
    async callback(input: { state: string; code?: string; error?: string }) {
      const encoded = await store.take(`${STATE_PREFIX}${input.state}`);
      if (!encoded) throw new Error('Email authorization state is invalid or expired');
      const state = stateSchema.parse(JSON.parse(encoded));
      const redirect = new URL(state.returnUri);
      if (input.error || !input.code) {
        redirect.searchParams.set('email_connection_error', input.error ?? 'authorization_denied');
        return redirect.toString();
      }
      try {
        const access = await authorize(state.userKey, state.organizationKey, state.scopeKey);
        if (access.membershipKey !== state.membershipKey) throw new Error('Email authorization membership changed');
        const result = await exchange(input.code, state.verifier, state.nonce);
        const gmailProfile = await profile(result.credentials.accessToken);
        const watch = await registerWatch(result.credentials.accessToken);
        const previous = await connectors.find(state.scopeKey);
        if (!result.credentials.refreshToken && previous?.providerAccountId === result.identity.providerAccountId) {
          result.credentials.refreshToken = connectors.credentials(previous).refreshToken;
        }
        if (!result.credentials.refreshToken) throw new Error('Gmail did not issue an offline refresh token');
        const connector = await connectors.upsert({
          organizationKey: state.organizationKey, scopeKey: state.scopeKey, createdByMembershipKey: state.membershipKey,
          providerAccountId: result.identity.providerAccountId, email: result.identity.email, scopes: result.scopes, credentials: result.credentials,
        });
        await repository.disableAccounts(state.scopeKey);
        const account = await repository.upsertAccount({ scopeKey: state.scopeKey, connectorKey: connector.key, providerAccountId: connector.providerAccountId, email: connector.email, historyId: watch?.historyId ?? gmailProfile.historyId });
        if (watch) await repository.updateWatch(account.key, watch);
        const grant = token('vrtx_email_grant_');
        const payload = grantSchema.parse({ userKey: state.userKey, organizationKey: state.organizationKey, scopeKey: state.scopeKey, connectorKey: connector.key, email: connector.email });
        if (!(await store.put(`${GRANT_PREFIX}${grant}`, JSON.stringify(payload), 300))) throw new Error('Could not create email connection grant');
        redirect.searchParams.set('email_connection_code', grant);
      } catch {
        redirect.searchParams.set('email_connection_error', 'connection_failed');
      }
      return redirect.toString();
    },
    async exchange(input: { userKey: string; organizationKey: string; scopeKey: string; code: string }) {
      const encoded = await store.take(`${GRANT_PREFIX}${input.code}`);
      if (!encoded) return null;
      const grant = grantSchema.parse(JSON.parse(encoded));
      if (grant.userKey !== input.userKey || grant.organizationKey !== input.organizationKey || grant.scopeKey !== input.scopeKey) return null;
      await authorize(input.userKey, input.organizationKey, input.scopeKey);
      const connector = await connectors.getByKey(grant.connectorKey);
      if (!connector || connector.status !== 'active' || connector.organizationKey !== input.organizationKey || connector.scopeKey !== input.scopeKey) return null;
      return connectorPublic(connector);
    },
  };
}

export type EmailOAuthService = ReturnType<typeof createEmailOAuthService>;
