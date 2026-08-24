import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireOrganizationAccess, requireScopeAccess } from '@/lib/founders/access';
import { redisConnection } from '@/lib/redis';
import { createConnectorRepository, type ConnectorRepository } from './connector-repository';
import { createInboxRepository, type InboxRepository } from './inbox-repository';
import { buildGmailAuthorizationUrl, createGmailClient, createPkce, exchangeGmailCode } from './gmail';
import { buildOutlookAuthorizationUrl, createOutlookClient, exchangeOutlookCode } from './outlook';
import { verifyICloudCredentials } from './icloud';
import { icloudEmailConnectorCredentialsSchema } from './connector-schema';

const STATE_PREFIX = 'email:oauth:state:';
const GRANT_PREFIX = 'email:oauth:grant:';
const stateSchema = z.object({
  userKey: z.string().cuid(), organizationKey: z.string().min(1), scopeKey: z.string().cuid(), membershipKey: z.string().cuid(),
  provider: z.enum(['gmail', 'outlook']).default('gmail'),
  returnUri: z.string().url(), verifier: z.string().min(43), nonce: z.string().min(20),
  name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).optional(),
}).strict();
const grantSchema = z.object({
  userKey: z.string().cuid(), organizationKey: z.string().min(1), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(),
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
  store?: OAuthStore; connectors?: ConnectorRepository; inboxes?: InboxRepository;
  exchange?: typeof exchangeGmailCode; authorize?: (userKey: string, organizationKey: string, scopeKey: string) => Promise<{ membershipKey: string }>;
  profile?: (accessToken: string) => Promise<{ historyId: string }>;
  outlookExchange?: typeof exchangeOutlookCode;
  outlookProfile?: (accessToken: string, email: string) => Promise<{ historyId: string }>;
  verifyICloud?: typeof verifyICloudCredentials;
  subscribe?: (actor: { userKey: string; organizationKey: string; scopeKey: string }, connectorKey: string, expectedRevision: string) => Promise<unknown>;
  ensureInbox?: (actor: { userKey: string; organizationKey: string; scopeKey: string }, connector: NonNullable<Awaited<ReturnType<ConnectorRepository['getByKey']>>>, metadata: { name: string; description?: string }, overwrite: boolean, expectedRevision: string | null) => Promise<unknown>;
  inboxView?: (actor: { userKey: string; organizationKey: string; scopeKey: string }, connectorKey: string) => Promise<unknown>;
} = {}) {
  const store = options.store ?? redisStore;
  const connectors = options.connectors ?? createConnectorRepository();
  const inboxes = options.inboxes ?? createInboxRepository();
  const exchange = options.exchange ?? exchangeGmailCode;
  const profile = options.profile ?? ((accessToken: string) => createGmailClient(accessToken).profile());
  const outlookExchange = options.outlookExchange ?? exchangeOutlookCode;
  const outlookProfile = options.outlookProfile ?? ((accessToken: string, email: string) => createOutlookClient(accessToken, email).profile());
  const verifyICloud = options.verifyICloud ?? verifyICloudCredentials;
  const subscribe = options.subscribe ?? (async (actor: { organizationKey: string; scopeKey: string }, connectorKey: string, expectedRevision: string) => (await import('./service')).createSystemEmailService({ connectors }).subscribe({ userKey: 'system', ...actor }, connectorKey, expectedRevision));
  const ensureInbox = options.ensureInbox ?? (async (actor, connector, metadata, overwrite, expectedRevision) => (await import('./service')).createEmailService({ connectors, inboxes }).ensureInbox(actor, connector, metadata, overwrite, expectedRevision));
  const inboxView = options.inboxView ?? (async (actor, connectorKey) => (await import('./service')).createEmailService({ connectors, inboxes }).inboxView(actor, connectorKey));
  const authorize = options.authorize ?? (async (userKey, organizationKey, scopeKey) => {
    const { membership } = await requireOrganizationAccess(userKey, organizationKey);
    await requireScopeAccess(membership, scopeKey);
    if (membership.orgRole !== 'owner' && membership.orgRole !== 'admin') throw new Error('Owner or admin role is required to connect email');
    return { membershipKey: membership.key };
  });
  return {
    async start(input: { userKey: string; organizationKey: string; scopeKey: string; provider?: 'gmail' | 'outlook'; name: string; description?: string; returnUri: string }) {
      const access = await authorize(input.userKey, input.organizationKey, input.scopeKey);
      const state = token('vrtx_email_state_');
      const nonce = randomBytes(24).toString('base64url');
      const pkce = createPkce();
      const record = stateSchema.parse({ ...input, provider: input.provider ?? 'gmail', membershipKey: access.membershipKey, returnUri: allowedReturnUri(input.returnUri), verifier: pkce.verifier, nonce });
      if (!(await store.put(`${STATE_PREFIX}${state}`, JSON.stringify(record), 600))) throw new Error('Could not create email authorization state');
      const buildAuthorizationUrl = record.provider === 'outlook' ? buildOutlookAuthorizationUrl : buildGmailAuthorizationUrl;
      return { authorizationUrl: buildAuthorizationUrl({ state, nonce, codeChallenge: pkce.challenge }) };
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
      let reconnect: { connectorKey: string; connectorRevision: string; inboxRevision?: string; previous: Awaited<ReturnType<ConnectorRepository['findExact']>>; previousInbox: Awaited<ReturnType<InboxRepository['getByConnector']>> } | undefined;
      try {
        const access = await authorize(state.userKey, state.organizationKey, state.scopeKey);
        if (access.membershipKey !== state.membershipKey) throw new Error('Email authorization membership changed');
        const result = await (state.provider === 'outlook' ? outlookExchange : exchange)(input.code, state.verifier, state.nonce);
        const providerProfile = state.provider === 'outlook' ? await outlookProfile(result.credentials.accessToken, result.identity.email) : await profile(result.credentials.accessToken);
        const previous = await connectors.findExact(state.organizationKey, state.scopeKey, result.identity.providerAccountId, state.provider);
        const previousInbox = previous ? await inboxes.getByConnector(state.organizationKey, state.scopeKey, previous.key) : null;
        if (!result.credentials.refreshToken && previous && previous.status !== 'revoked' && previous.encryptedCredentials !== 'revoked') {
          const previousCredentials = connectors.credentials(previous);
          if ('refreshToken' in previousCredentials) result.credentials.refreshToken = previousCredentials.refreshToken;
        }
        if (!result.credentials.refreshToken) throw new Error(`${state.provider === 'outlook' ? 'Outlook' : 'Gmail'} did not issue an offline refresh token`);
        const initializeInactive = !previous || previous.status === 'revoked';
        let connector = await connectors.upsert({
          organizationKey: state.organizationKey, scopeKey: state.scopeKey, createdByMembershipKey: state.membershipKey,
          provider: state.provider, providerAccountId: result.identity.providerAccountId, email: result.identity.email, scopes: result.scopes, credentials: result.credentials, initializeInactive,
          expectedRevision: previous?.revision ?? null,
        });
        reconnect = { connectorKey: connector.key, connectorRevision: connector.revision, previous, previousInbox };
        const initializedInbox = await ensureInbox({ userKey: state.userKey, organizationKey: state.organizationKey, scopeKey: state.scopeKey }, connector, { name: state.name, ...(state.description ? { description: state.description } : {}) }, previous !== null, previousInbox?.revision ?? null) as { revision?: string } | undefined;
        if (initializedInbox?.revision) reconnect.inboxRevision = initializedInbox.revision;
        const syncRevision = await connectors.setSyncState(connector.key, 'idle', { historyId: providerProfile.historyId, pendingHistoryId: null, pendingThreadIds: null, resetLastSynced: true, markSynced: false, expectedRevision: reconnect.connectorRevision });
        if (!syncRevision) throw new Error('Could not initialize email synchronization state');
        reconnect.connectorRevision = syncRevision;
        if (initializeInactive) {
          const activated = await connectors.activateInitialization(connector.key, connector.accessTokenFingerprint, reconnect.connectorRevision);
          if (!activated) throw new Error('Could not activate initialized email connector');
          connector = activated;
          reconnect.connectorRevision = activated.revision;
        }
        const grant = token('vrtx_email_grant_');
        const payload = grantSchema.parse({ userKey: state.userKey, organizationKey: state.organizationKey, scopeKey: state.scopeKey, connectorKey: connector.key });
        if (!(await store.put(`${GRANT_PREFIX}${grant}`, JSON.stringify(payload), 300))) throw new Error('Could not create email connection grant');
        await subscribe({ userKey: state.userKey, organizationKey: state.organizationKey, scopeKey: state.scopeKey }, connector.key, reconnect.connectorRevision).catch((error) => {
          if (error instanceof AggregateError) throw error;
        });
        redirect.searchParams.set('email_connection_code', grant);
      } catch {
        if (reconnect) await connectors.rollbackReconnect({ connectorKey: reconnect.connectorKey, connectorRevision: reconnect.connectorRevision, previousConnector: reconnect.previous, inboxRevision: reconnect.inboxRevision, previousInbox: reconnect.previousInbox }).catch(() => false);
        redirect.searchParams.set('email_connection_error', 'connection_failed');
      }
      return redirect.toString();
    },
    async connectICloud(input: { userKey: string; organizationKey: string; scopeKey: string; email: string; appPassword: string; name: string; description?: string }) {
      const access = await authorize(input.userKey, input.organizationKey, input.scopeKey);
      const credentials = icloudEmailConnectorCredentialsSchema.parse({ username: input.email.toLowerCase(), appPassword: input.appPassword });
      const identity = await verifyICloud(credentials);
      const previous = await connectors.findExact(input.organizationKey, input.scopeKey, identity.providerAccountId, 'icloud');
      const previousInbox = previous ? await inboxes.getByConnector(input.organizationKey, input.scopeKey, previous.key) : null;
      let reconnect: { connectorKey: string; connectorRevision: string; inboxRevision?: string } | undefined;
      try {
        const initializeInactive = !previous || previous.status === 'revoked';
        let connector = await connectors.upsert({
          organizationKey: input.organizationKey, scopeKey: input.scopeKey, provider: 'icloud', providerAccountId: identity.providerAccountId,
          email: identity.email, scopes: ['imap', 'smtp'], createdByMembershipKey: access.membershipKey, credentials, initializeInactive,
          expectedRevision: previous?.revision ?? null,
        });
        reconnect = { connectorKey: connector.key, connectorRevision: connector.revision };
        const initializedInbox = await ensureInbox({ userKey: input.userKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey }, connector, { name: input.name, ...(input.description ? { description: input.description } : {}) }, previous !== null, previousInbox?.revision ?? null) as { revision?: string } | undefined;
        if (initializedInbox?.revision) reconnect.inboxRevision = initializedInbox.revision;
        const syncRevision = await connectors.setSyncState(connector.key, 'idle', { historyId: new Date().toISOString(), pendingHistoryId: null, pendingThreadIds: null, resetLastSynced: true, markSynced: false, expectedRevision: reconnect.connectorRevision });
        if (!syncRevision) throw new Error('Could not initialize email synchronization state');
        reconnect.connectorRevision = syncRevision;
        if (initializeInactive) {
          const activated = await connectors.activateInitialization(connector.key, connector.accessTokenFingerprint, reconnect.connectorRevision);
          if (!activated) throw new Error('Could not activate initialized email connector');
          connector = activated;
          reconnect.connectorRevision = activated.revision;
        }
        const view = await inboxView({ userKey: input.userKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey }, connector.key);
        if (!view) throw new Error('Could not load connected iCloud inbox');
        return view;
      } catch (error) {
        if (reconnect) await connectors.rollbackReconnect({ connectorKey: reconnect.connectorKey, connectorRevision: reconnect.connectorRevision, previousConnector: previous, inboxRevision: reconnect.inboxRevision, previousInbox }).catch(() => false);
        throw error;
      }
    },
    async exchange(input: { userKey: string; organizationKey: string; scopeKey: string; code: string }) {
      const encoded = await store.take(`${GRANT_PREFIX}${input.code}`);
      if (!encoded) return null;
      const grant = grantSchema.parse(JSON.parse(encoded));
      if (grant.userKey !== input.userKey || grant.organizationKey !== input.organizationKey || grant.scopeKey !== input.scopeKey) return null;
      await authorize(input.userKey, input.organizationKey, input.scopeKey);
      const connector = await connectors.getByKey(grant.connectorKey);
      if (!connector || connector.status !== 'active' || connector.organizationKey !== input.organizationKey || connector.scopeKey !== input.scopeKey) return null;
      return inboxView({ userKey: input.userKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey }, connector.key);
    },
  };
}

export type EmailOAuthService = ReturnType<typeof createEmailOAuthService>;
