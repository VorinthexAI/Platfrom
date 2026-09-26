import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireTeamAccess, requireScopeAccess } from '@/lib/founders/access';
import { redisConnection } from '@/lib/redis';
import { createConnectorRepository, type ConnectorRepository } from './connector-repository';
import { createInboxRepository, type InboxRepository } from './inbox-repository';
import { logEmailFlow } from './flow-log';
import { buildGmailAuthorizationUrl, createGmailClient, createPkce, exchangeGmailCode, GmailApiError, hasGmailMailScope } from './gmail';

const STATE_PREFIX = 'email:oauth:state:';
const GRANT_PREFIX = 'email:oauth:grant:';

export interface EmailOAuthFailureDiagnostic { stage: string; errorName?: string; databaseCode?: number; providerStatus?: number; providerReason?: 'SERVICE_DISABLED' | 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' | 'GMAIL_DISABLED' }

function gmailFailureReason(error: unknown): EmailOAuthFailureDiagnostic['providerReason'] {
  if (!(error instanceof GmailApiError)) return undefined;
  const body = error.metadata.details && typeof error.metadata.details === 'object' ? error.metadata.details as { error?: { details?: unknown } } : undefined;
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const reasons = [
    ...error.reasons,
    ...details.flatMap((item) => item && typeof item === 'object' && 'reason' in item && typeof item.reason === 'string' ? [item.reason] : []),
  ];
  if (reasons.some((reason) => ['SERVICE_DISABLED', 'accessNotConfigured', 'API_DISABLED'].includes(reason))) return 'SERVICE_DISABLED';
  if (reasons.some((reason) => ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions'].includes(reason))) return 'ACCESS_TOKEN_SCOPE_INSUFFICIENT';
  if (reasons.some((reason) => ['GMAIL_DISABLED', 'mailServiceDisabled'].includes(reason))) return 'GMAIL_DISABLED';
  return undefined;
}

function failureDiagnostic(stage: string, error: unknown): EmailOAuthFailureDiagnostic {
  const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const providerReason = gmailFailureReason(error);
  return { stage, ...(error instanceof Error && error.name ? { errorName: error.name.slice(0, 80) } : {}), ...(typeof details.errorNum === 'number' ? { databaseCode: details.errorNum } : {}), ...(typeof details.status === 'number' ? { providerStatus: details.status } : {}), ...(providerReason ? { providerReason } : {}) };
}
const stateSchema = z.object({
  userKey: z.string().cuid(), teamKey: z.string().min(1), scopeKey: z.string().cuid(),
  provider: z.literal('gmail').default('gmail'),
  returnUri: z.string().url(), verifier: z.string().min(43), nonce: z.string().min(20),
  name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).optional(),
}).strict();
const grantSchema = z.object({
  userKey: z.string().cuid(), teamKey: z.string().min(1), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(),
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
  const allowed = new Set([
    'vorinthexcore://capability/signal',
    'https://vorinthex.com/capability/signal',
    ...(process.env.EMAIL_CONNECTOR_MOBILE_REDIRECT_URIS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  ]);
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  if (!allowed.has(url.toString())) throw new Error('Email connector return URI is not allowed');
  return url.toString();
}

export function createEmailOAuthService(options: {
  store?: OAuthStore; connectors?: ConnectorRepository; inboxes?: InboxRepository;
  exchange?: typeof exchangeGmailCode; authorize?: (userKey: string, teamKey: string, scopeKey: string) => Promise<{ teamMembershipKey: string }>;
  profile?: (accessToken: string) => Promise<{ historyId: string }>;
  registerWatch?: (actor: { userKey: string; teamKey: string; scopeKey: string }, connectorKey: string, expectedRevision: string) => Promise<unknown>;
  enqueueInitialSync?: (input: { teamKey: string; scopeKey: string; connectorKey: string; operationKey: string }) => Promise<unknown>;
  ensureInbox?: (actor: { userKey: string; teamKey: string; scopeKey: string }, connector: NonNullable<Awaited<ReturnType<ConnectorRepository['getByKey']>>>, metadata: { name: string; description?: string }, overwrite: boolean, expectedRevision: string | null) => Promise<unknown>;
  inboxView?: (actor: { userKey: string; teamKey: string; scopeKey: string }, connectorKey: string) => Promise<unknown>;
  reportFailure?: (diagnostic: EmailOAuthFailureDiagnostic) => void;
} = {}) {
  const store = options.store ?? redisStore;
  const connectors = options.connectors ?? createConnectorRepository();
  const inboxes = options.inboxes ?? createInboxRepository();
  const exchange = options.exchange ?? exchangeGmailCode;
  const profile = options.profile ?? ((accessToken: string) => createGmailClient(accessToken).profile());
  const registerWatch = options.registerWatch ?? (async (actor: { teamKey: string; scopeKey: string }, connectorKey: string, expectedRevision: string) => (await import('./service')).createSystemEmailService({ connectors }).registerWatch({ userKey: 'system', ...actor }, connectorKey, expectedRevision));
  const enqueueInitialSync = options.enqueueInitialSync ?? (async (input) => (await import('./sync-queue')).enqueueEmailInitialSync(input));
  const ensureInbox = options.ensureInbox ?? (async (actor, connector, metadata, overwrite, expectedRevision) => (await import('./service')).createEmailService({ connectors, inboxes }).ensureInbox(actor, connector, metadata, overwrite, expectedRevision));
  const inboxView = options.inboxView ?? (async (actor, connectorKey) => (await import('./service')).createEmailService({ connectors, inboxes }).inboxView(actor, connectorKey));
  const authorize = options.authorize ?? (async (userKey, teamKey, scopeKey) => {
    const { membership } = await requireTeamAccess(userKey, teamKey);
    await requireScopeAccess(membership, scopeKey);
    return { teamMembershipKey: membership.key };
  });
  return {
    async start(input: { userKey: string; teamKey: string; scopeKey: string; provider?: 'gmail'; name: string; description?: string; returnUri: string }) {
      logEmailFlow('oauth.start.begin', { userKey: input.userKey, teamKey: input.teamKey, scopeKey: input.scopeKey, returnUri: input.returnUri, hasDescription: Boolean(input.description) });
      await authorize(input.userKey, input.teamKey, input.scopeKey);
      const state = token('vrtx_email_state_');
      const nonce = randomBytes(24).toString('base64url');
      const pkce = createPkce();
      const record = stateSchema.parse({ ...input, provider: input.provider ?? 'gmail', returnUri: allowedReturnUri(input.returnUri), verifier: pkce.verifier, nonce });
      if (!(await store.put(`${STATE_PREFIX}${state}`, JSON.stringify(record), 600))) throw new Error('Could not create email authorization state');
      logEmailFlow('oauth.start.ok', { userKey: input.userKey, teamKey: input.teamKey, scopeKey: input.scopeKey, returnUri: record.returnUri });
      return { authorizationUrl: buildGmailAuthorizationUrl({ state, nonce, codeChallenge: pkce.challenge }) };
    },
    async callback(input: { state: string; code?: string; error?: string }) {
      logEmailFlow('oauth.callback.begin', { hasState: Boolean(input.state), hasCode: Boolean(input.code), providerError: input.error ?? null });
      const encoded = await store.take(`${STATE_PREFIX}${input.state}`);
      if (!encoded) {
        logEmailFlow('oauth.callback.missing-state', { hasState: Boolean(input.state) });
        throw new Error('Email authorization state is invalid or expired');
      }
      const state = stateSchema.parse(JSON.parse(encoded));
      const redirect = new URL(state.returnUri);
      logEmailFlow('oauth.callback.state', { userKey: state.userKey, teamKey: state.teamKey, scopeKey: state.scopeKey, returnUri: state.returnUri });
      if (input.error || !input.code) {
        const code = input.error ?? 'authorization_denied';
        logEmailFlow('oauth.callback.provider-denied', { userKey: state.userKey, error: code });
        redirect.searchParams.set('email_connection_error', code);
        return redirect.toString();
      }
      let reconnect: { connectorKey: string; connectorRevision: string; inboxKey?: string; inboxRevision?: string; previous: Awaited<ReturnType<ConnectorRepository['findExact']>>; previousInbox: Awaited<ReturnType<InboxRepository['getByConnector']>> } | undefined;
      let stage = 'authorize';
      try {
        await authorize(state.userKey, state.teamKey, state.scopeKey);
        stage = 'token-exchange';
        logEmailFlow('oauth.callback.stage', { stage, userKey: state.userKey });
        const result = await exchange(input.code, state.verifier, state.nonce);
        stage = 'gmail-scope';
        logEmailFlow('oauth.callback.stage', { stage, userKey: state.userKey, scopes: result.scopes, hasRefreshToken: Boolean(result.credentials.refreshToken) });
        if (!hasGmailMailScope(result.scopes)) throw new Error('Gmail mail scope was not granted');
        stage = 'gmail-profile';
        logEmailFlow('oauth.callback.stage', { stage, userKey: state.userKey, scopes: result.scopes, hasRefreshToken: Boolean(result.credentials.refreshToken) });
        const providerProfile = await profile(result.credentials.accessToken);
        stage = 'connector-persistence';
        logEmailFlow('oauth.callback.stage', { stage, userKey: state.userKey, historyId: providerProfile.historyId });
        const previous = await connectors.findExact(state.userKey, result.identity.providerAccountId, state.provider);
        const previousInbox = previous ? await inboxes.getByConnector(state.userKey, previous.key) : null;
        if (!result.credentials.refreshToken && previous && previous.status !== 'revoked' && previous.encryptedCredentials !== 'revoked') {
          const previousCredentials = connectors.credentials(previous);
          if ('refreshToken' in previousCredentials) result.credentials.refreshToken = previousCredentials.refreshToken;
        }
        if (!result.credentials.refreshToken) throw new Error('Gmail did not issue an offline refresh token');
        const initializeInactive = !previous || previous.status === 'revoked';
        let connector = await connectors.upsert({
          userKey: state.userKey, teamKey: state.teamKey, scopeKey: state.scopeKey,
          provider: state.provider, providerAccountId: result.identity.providerAccountId, email: result.identity.email, scopes: result.scopes, credentials: result.credentials, initializeInactive,
          expectedRevision: previous?.revision ?? null,
        });
        reconnect = { connectorKey: connector.key, connectorRevision: connector.revision, previous, previousInbox };
        logEmailFlow('oauth.callback.connector', { connectorKey: connector.key, initializeInactive, hadPrevious: Boolean(previous), status: connector.status });
        stage = 'inbox-initialization';
        logEmailFlow('oauth.callback.stage', { stage, connectorKey: connector.key });
        const initializedInbox = await ensureInbox({ userKey: state.userKey, teamKey: state.teamKey, scopeKey: state.scopeKey }, connector, { name: state.name, ...(state.description ? { description: state.description } : {}) }, previous !== null, previousInbox?.revision ?? null) as { key?: string; revision?: string } | undefined;
        if (initializedInbox?.revision) { reconnect.inboxKey = initializedInbox.key; reconnect.inboxRevision = initializedInbox.revision; }
        logEmailFlow('oauth.callback.inbox', { connectorKey: connector.key, inboxKey: initializedInbox?.key ?? null });
        stage = 'sync-initialization';
        logEmailFlow('oauth.callback.stage', { stage, connectorKey: connector.key });
        const syncRevision = await connectors.setSyncState(connector.key, 'idle', { historyId: providerProfile.historyId, pendingHistoryId: null, pendingThreadIds: null, pendingSubscriptionMessages: null, resetLastSynced: true, markSynced: false, expectedRevision: reconnect.connectorRevision });
        if (!syncRevision) throw new Error('Could not initialize email synchronization state');
        reconnect.connectorRevision = syncRevision;
        if (initializeInactive) {
          const activated = await connectors.activateInitialization(connector.key, connector.accessTokenFingerprint, reconnect.connectorRevision);
          if (!activated) throw new Error('Could not activate initialized email connector');
          connector = activated;
          reconnect.connectorRevision = activated.revision;
        }
        stage = 'gmail-watch';
        logEmailFlow('oauth.callback.stage', { stage, connectorKey: connector.key, connectorRevision: reconnect.connectorRevision });
        const watch = await registerWatch({ userKey: state.userKey, teamKey: state.teamKey, scopeKey: state.scopeKey }, connector.key, reconnect.connectorRevision) as { connectorRevision?: string } | undefined;
        if (watch?.connectorRevision) reconnect.connectorRevision = watch.connectorRevision;
        logEmailFlow('oauth.callback.watch', { connectorKey: connector.key, watchRevision: watch?.connectorRevision ?? null });
        stage = 'initial-sync-enqueue';
        logEmailFlow('oauth.callback.stage', { stage, connectorKey: connector.key });
        await enqueueInitialSync({ teamKey: state.teamKey, scopeKey: state.scopeKey, connectorKey: connector.key, operationKey: randomUUID() });
        stage = 'connection-grant';
        logEmailFlow('oauth.callback.stage', { stage, connectorKey: connector.key });
        const grant = token('vrtx_email_grant_');
        const payload = grantSchema.parse({ userKey: state.userKey, teamKey: state.teamKey, scopeKey: state.scopeKey, connectorKey: connector.key });
        if (!(await store.put(`${GRANT_PREFIX}${grant}`, JSON.stringify(payload), 300))) throw new Error('Could not create email connection grant');
        logEmailFlow('oauth.callback.grant', { connectorKey: connector.key, userKey: state.userKey, returnUri: state.returnUri });
        redirect.searchParams.set('email_connection_code', grant);
      } catch (error) {
        // Never log callback URLs, authorization codes, tokens, or provider bodies.
        try { (options.reportFailure ?? ((diagnostic) => console.warn('email oauth connection failed', diagnostic)))(failureDiagnostic(stage, error)); } catch { /* Diagnostics cannot prevent the app return. */ }
        if (reconnect) await connectors.rollbackReconnect({ connectorKey: reconnect.connectorKey, connectorRevision: reconnect.connectorRevision, previousConnector: reconnect.previous, inboxKey: reconnect.inboxKey, inboxRevision: reconnect.inboxRevision, previousInbox: reconnect.previousInbox }).catch(() => false);
        const reason = gmailFailureReason(error);
        const code = stage === 'gmail-profile' && reason === 'SERVICE_DISABLED' ? 'gmail_api_unavailable'
          : stage === 'gmail-scope' || (stage === 'gmail-profile' && reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') ? 'gmail_scope_missing'
          : stage === 'gmail-profile' && reason === 'GMAIL_DISABLED' ? 'gmail_account_unavailable'
          : stage === 'token-exchange' ? 'gmail_authorization_failed'
          : stage === 'gmail-watch' ? 'gmail_watch_unavailable'
          : stage === 'initial-sync-enqueue' ? 'gmail_sync_unavailable'
          : 'connection_failed';
        logEmailFlow('oauth.callback.failed', { stage, userKey: state.userKey, connectorKey: reconnect?.connectorKey ?? null, error, code });
        redirect.searchParams.set('email_connection_error', code);
      }
      return redirect.toString();
    },
    async exchange(input: { userKey: string; teamKey: string; scopeKey: string; code: string }) {
      logEmailFlow('oauth.exchange.begin', { userKey: input.userKey, teamKey: input.teamKey, scopeKey: input.scopeKey, hasCode: Boolean(input.code) });
      const encoded = await store.take(`${GRANT_PREFIX}${input.code}`);
      if (!encoded) {
        logEmailFlow('oauth.exchange.invalid', { userKey: input.userKey, reason: 'missing-grant' });
        return null;
      }
      const grant = grantSchema.parse(JSON.parse(encoded));
      if (grant.userKey !== input.userKey || grant.teamKey !== input.teamKey || grant.scopeKey !== input.scopeKey) {
        logEmailFlow('oauth.exchange.invalid', { userKey: input.userKey, reason: 'actor-mismatch', grantUserKey: grant.userKey, connectorKey: grant.connectorKey });
        return null;
      }
      await authorize(input.userKey, input.teamKey, input.scopeKey);
      const connector = await connectors.getByKey(grant.connectorKey);
      if (!connector || connector.status !== 'active' || connector.userKey !== input.userKey) {
        logEmailFlow('oauth.exchange.invalid', { userKey: input.userKey, reason: 'connector-unavailable', connectorKey: grant.connectorKey, status: connector?.status ?? null });
        return null;
      }
      logEmailFlow('oauth.exchange.ok', { userKey: input.userKey, connectorKey: connector.key });
      return inboxView({ userKey: input.userKey, teamKey: input.teamKey, scopeKey: input.scopeKey }, connector.key);
    },
  };
}

export type EmailOAuthService = ReturnType<typeof createEmailOAuthService>;
