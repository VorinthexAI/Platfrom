import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OAuthEmailConnectorCredentials } from './connector-schema';
import type { GmailMessageResource, GmailThreadResource } from './gmail';

export const OUTLOOK_SCOPES = ['openid', 'email', 'offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send'] as const;
const OUTLOOK_STAR_CATEGORY = 'Vorinthex Starred';

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1).default('Bearer'),
  scope: z.string().optional(),
}).passthrough();
const identitySchema = z.object({ id: z.string().min(1), mail: z.string().email().nullable().optional(), userPrincipalName: z.string().email() }).passthrough();
const REQUIRED_GRAPH_SCOPES = ['User.Read', 'Mail.ReadWrite', 'Mail.Send'] as const;

function configuration(environment: NodeJS.ProcessEnv = process.env) {
  const clientId = environment.OUTLOOK_OAUTH_CLIENT_ID;
  const clientSecret = environment.OUTLOOK_OAUTH_CLIENT_SECRET;
  const tenant = environment.OUTLOOK_OAUTH_TENANT?.trim() || 'common';
  const origin = environment.BACKEND_PUBLIC_URL ?? 'http://localhost:3001';
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth is not configured');
  return { clientId, clientSecret, tenant, redirectUri: environment.OUTLOOK_OAUTH_REDIRECT_URI ?? new URL('/api/v1/email/connectors/outlook/callback', origin).toString() };
}

function oauthCredentials(token: z.infer<typeof tokenSchema>, refreshToken?: string): OAuthEmailConnectorCredentials {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    tokenType: token.token_type,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  };
}

function tokenScopes(token: z.infer<typeof tokenSchema>) {
  const scopes = (token.scope ?? OUTLOOK_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
  if (token.scope) {
    const granted = new Set(scopes.map((scope) => scope.toLowerCase()));
    if (REQUIRED_GRAPH_SCOPES.some((scope) => !granted.has(scope.toLowerCase()))) throw new Error('Outlook authorization did not grant the required mail scopes');
  }
  return scopes;
}

export function buildOutlookAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }, environment: NodeJS.ProcessEnv = process.env) {
  const config = configuration(environment);
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', OUTLOOK_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeOutlookCode(code: string, verifier: string, _nonce: string, fetcher: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
  const config = configuration(environment);
  const response = await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', scope: OUTLOOK_SCOPES.join(' ') }).toString(),
  });
  if (!response.ok) throw new Error('Outlook authorization code exchange failed');
  const token = tokenSchema.parse(await response.json());
  const scopes = tokenScopes(token);
  const identityResponse = await fetcher('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!identityResponse.ok) throw new Error('Outlook identity lookup failed');
  const identity = identitySchema.parse(await identityResponse.json());
  return {
    identity: { providerAccountId: identity.id, email: (identity.mail ?? identity.userPrincipalName).toLowerCase() },
    scopes,
    credentials: oauthCredentials(token),
  };
}

export async function refreshOutlookCredentials(credentials: OAuthEmailConnectorCredentials, fetcher: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
  if (!credentials.refreshToken) throw new Error('Outlook refresh token is unavailable');
  const config = configuration(environment);
  const response = await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: credentials.refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', scope: OUTLOOK_SCOPES.join(' ') }).toString(),
  });
  if (!response.ok) throw new Error('Outlook token refresh failed');
  const token = tokenSchema.parse(await response.json());
  tokenScopes(token);
  return oauthCredentials(token, credentials.refreshToken);
}

export class OutlookApiError extends Error {
  readonly code?: string;
  readonly body?: unknown;
  readonly requestId?: string;
  readonly clientRequestId?: string;
  readonly retryAfter?: string;
  readonly retryAfterMs?: number;
  readonly location?: string;
  readonly resetUrl?: string;

  constructor(readonly status: number, details: {
    code?: string; body?: unknown; requestId?: string; clientRequestId?: string;
    retryAfter?: string; retryAfterMs?: number; location?: string;
  } = {}) {
    const providerMessage = details.body && typeof details.body === 'object' && 'error' in details.body
      && details.body.error && typeof details.body.error === 'object' && 'message' in details.body.error && typeof details.body.error.message === 'string'
      ? details.body.error.message : undefined;
    super(providerMessage ? `Outlook API request failed (${status}): ${providerMessage}` : `Outlook API request failed (${status})`);
    this.name = 'OutlookApiError';
    this.code = details.code;
    this.body = details.body;
    this.requestId = details.requestId;
    this.clientRequestId = details.clientRequestId;
    this.retryAfter = details.retryAfter;
    this.retryAfterMs = details.retryAfterMs;
    this.location = details.location;
    this.resetUrl = status === 410 && details.location ? details.location : undefined;
  }
}
export function isRetryableOutlookError(error: unknown) { return error instanceof OutlookApiError && (error.status === 408 || error.status === 429 || error.status >= 500); }

type GraphMessage = {
  id: string; conversationId: string; internetMessageId?: string; subject?: string; bodyPreview?: string;
  body?: { contentType?: string; content?: string }; receivedDateTime?: string; sentDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } }; toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>; bccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  replyTo?: Array<{ emailAddress?: { address?: string; name?: string } }>; internetMessageHeaders?: Array<{ name: string; value: string }>;
  categories?: string[]; isRead?: boolean; isDraft?: boolean; hasAttachments?: boolean; parentFolderId?: string;
  '@removed'?: { reason?: string };
};
type GraphPage<T> = { value?: T[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };

const GRAPH_CONCURRENCY = 8;
const GRAPH_RETRY_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;
const OUTLOOK_FOLDERS = ['inbox', 'deleteditems', 'junkemail', 'sentitems'] as const;
type OutlookFolder = typeof OUTLOOK_FOLDERS[number];
const MAX_CURSOR_LENGTH = 256_000;
const MAX_GRAPH_URL_LENGTH = 16_000;
const MAX_FOLDER_PAGES = 10_000;
const RECENT_CONTINUATION_COUNT = 8;
const cursorHashSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const graphUrlSchema = z.string().max(MAX_GRAPH_URL_LENGTH).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'graph.microsoft.com' && url.port === '' && !url.username && !url.password && !url.hash && url.pathname.startsWith('/v1.0/');
  } catch { return false; }
}, 'Invalid Outlook Graph continuation URL');
const deltaFoldersSchema = z.object({ inbox: graphUrlSchema.nullable(), deleteditems: graphUrlSchema.nullable(), junkemail: graphUrlSchema.nullable(), sentitems: graphUrlSchema.nullable() }).strict();
const deltaCursorSchema = z.object({ v: z.literal(1), k: z.literal('outlook-delta'), f: deltaFoldersSchema }).strict().refine(({ f }) => {
  const completed = OUTLOOK_FOLDERS.filter((folder) => f[folder] !== null).length;
  return completed === 0 || completed === OUTLOOK_FOLDERS.length;
}, 'Outlook delta history cursor must be initial or complete');
const deltaPageCursorSchema = z.object({
  v: z.literal(2), k: z.literal('outlook-delta-page'), b: z.string().regex(/^[A-Za-z0-9_-]{43}$/), i: z.number().int().min(0).max(OUTLOOK_FOLDERS.length - 1),
  n: graphUrlSchema, f: deltaFoldersSchema, x: z.array(cursorHashSchema).max(RECENT_CONTINUATION_COUNT), p: z.number().int().min(0).max(MAX_FOLDER_PAGES),
}).strict();
const listCursorSchema = z.object({
  v: z.literal(2), k: z.literal('outlook-list'), i: z.number().int().min(0).max(OUTLOOK_FOLDERS.length - 1), n: graphUrlSchema.nullable(),
  q: z.array(z.string().min(1).max(512)).max(100), x: z.array(cursorHashSchema).max(RECENT_CONTINUATION_COUNT), p: z.number().int().min(0).max(MAX_FOLDER_PAGES),
}).strict();
type DeltaFolders = z.infer<typeof deltaFoldersSchema>;

function encodeCursor(value: unknown) {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  if (encoded.length > MAX_CURSOR_LENGTH) throw new Error('Outlook cursor exceeds the safe size limit');
  return encoded;
}

function decodeCursor(token: string, description: string) {
  if (!token || token.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error(`Invalid Outlook ${description} cursor`);
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token) throw new Error('Non-canonical cursor');
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch { throw new Error(`Invalid Outlook ${description} cursor`); }
}

function cursorHash(value: string, length = 16) { return createHash('sha256').update(value).digest().subarray(0, length).toString('base64url'); }
function absoluteGraphUrl(path: string) { return new URL(path, 'https://graph.microsoft.com/v1.0/').toString(); }
function initialFolderUrl(folder: OutlookFolder, mode: 'list' | 'delta', top: number) {
  const suffix = mode === 'delta' ? '/delta' : '';
  const select = mode === 'delta' ? 'id,conversationId,isDraft' : 'id,conversationId,isDraft';
  return absoluteGraphUrl(`me/mailFolders/${folder}/messages${suffix}?$select=${select}&$top=${top}`);
}
function validateFolderUrl(value: string, folder: OutlookFolder, mode: 'list' | 'delta') {
  graphUrlSchema.parse(value);
  const suffix = mode === 'delta' ? '/delta' : '';
  if (new URL(value).pathname !== `/v1.0/me/mailFolders/${folder}/messages${suffix}`) throw new Error(`Invalid Outlook ${mode} cursor URL`);
  return value;
}
function validateDeltaFolders(folders: DeltaFolders) {
  for (const folder of OUTLOOK_FOLDERS) if (folders[folder]) validateFolderUrl(folders[folder]!, folder, 'delta');
  return folders;
}
function initialDeltaFolders(): DeltaFolders { return { inbox: null, deleteditems: null, junkemail: null, sentitems: null }; }
function initialDeltaCursor() { return encodeCursor(deltaCursorSchema.parse({ v: 1, k: 'outlook-delta', f: initialDeltaFolders() })); }
function isLegacyDeltaCursor(value: string) {
  if (value === 'outlook:initial') return true;
  try { validateFolderUrl(value, 'inbox', 'delta'); return true; } catch { return false; }
}

function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function settledMap<T, R>(values: T[], operation: (value: T) => Promise<R>, concurrency = GRAPH_CONCURRENCY) {
  const results: Array<PromiseSettledResult<R>> = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await operation(values[index]!) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}

async function boundedMap<T, R>(values: T[], operation: (value: T) => Promise<R>) {
  const results = await settledMap(values, operation);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<R>).value);
}

function address(value?: { address?: string; name?: string }) { return value?.address ? value.name ? `${value.name} <${value.address}>` : value.address : ''; }
type OutlookFolderIds = { inbox: string; trash: string; junk: string; sent: string };

function graphMessage(resource: GraphMessage, ownEmail: string, folders: OutlookFolderIds): GmailMessageResource {
  const headers = [...(resource.internetMessageHeaders ?? [])];
  const setHeader = (name: string, value: string) => { if (value && !headers.some((item) => item.name.toLowerCase() === name.toLowerCase())) headers.push({ name, value }); };
  setHeader('From', address(resource.from?.emailAddress) || ownEmail);
  setHeader('To', (resource.toRecipients ?? []).map(({ emailAddress }) => address(emailAddress)).filter(Boolean).join(', '));
  setHeader('Cc', (resource.ccRecipients ?? []).map(({ emailAddress }) => address(emailAddress)).filter(Boolean).join(', '));
  setHeader('Bcc', (resource.bccRecipients ?? []).map(({ emailAddress }) => address(emailAddress)).filter(Boolean).join(', '));
  setHeader('Reply-To', (resource.replyTo ?? []).map(({ emailAddress }) => address(emailAddress)).filter(Boolean).join(', '));
  setHeader('Subject', resource.subject ?? '(No subject)');
  setHeader('Message-ID', resource.internetMessageId ?? '');
  const labels = (resource.categories ?? []).map((category) => `OUTLOOK_CATEGORY:${category}`);
  if (resource.categories?.includes(OUTLOOK_STAR_CATEGORY)) labels.push('STARRED');
  if (!resource.isRead) labels.push('UNREAD');
  if (resource.parentFolderId === folders.inbox) labels.push('INBOX');
  if (resource.parentFolderId === folders.trash) labels.push('TRASH');
  if (resource.parentFolderId === folders.junk) labels.push('SPAM');
  if (resource.parentFolderId === folders.sent) labels.push('SENT');
  const mimeType = resource.body?.contentType?.toLowerCase() === 'html' ? 'text/html' : 'text/plain';
  return {
    id: resource.id,
    threadId: resource.conversationId,
    labelIds: [...new Set(labels)],
    snippet: resource.bodyPreview,
    internalDate: String(new Date(resource.sentDateTime ?? resource.receivedDateTime ?? Date.now()).getTime()),
    payload: { mimeType, headers, body: { data: Buffer.from(resource.body?.content ?? resource.bodyPreview ?? '').toString('base64url') }, ...(resource.hasAttachments ? { parts: [{ filename: 'attachment' }] } : {}) },
  };
}

export function createOutlookClient(accessToken: string, ownEmail: string, fetcher: typeof fetch = fetch) {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const url = new URL(path, 'https://graph.microsoft.com/v1.0/');
    if (url.origin !== 'https://graph.microsoft.com') throw new Error('Invalid Outlook API continuation URL');
    const method = (init?.method ?? 'GET').toUpperCase();
    const canRetry = method === 'GET' || method === 'HEAD' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
      || (method === 'POST' && url.pathname.endsWith('/permanentDelete'));
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    if (!headers.has('Prefer')) headers.set('Prefer', 'IdType="ImmutableId"');
    for (let attempt = 0; attempt < GRAPH_RETRY_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000), headers });
      } catch (error) {
        if (!canRetry || attempt === GRAPH_RETRY_ATTEMPTS - 1 || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      if (response.ok) {
        if (response.status === 202 || response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      const delay = retryAfterMs(retryAfter ?? null);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (canRetry && retryable && attempt < GRAPH_RETRY_ATTEMPTS - 1 && (delay === undefined || delay <= MAX_RETRY_AFTER_MS)) {
        await new Promise((resolve) => setTimeout(resolve, delay ?? 250 * 2 ** attempt));
        continue;
      }
      const text = await response.text();
      let body: unknown = text || null;
      if (text) { try { body = JSON.parse(text); } catch {} }
      const providerError = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' ? body.error : undefined;
      const code = providerError && 'code' in providerError && typeof providerError.code === 'string' ? providerError.code : undefined;
      throw new OutlookApiError(response.status, {
        code, body,
        requestId: response.headers.get('request-id') ?? undefined,
        clientRequestId: response.headers.get('client-request-id') ?? undefined,
        retryAfter, retryAfterMs: delay,
        location: response.headers.get('location') ?? undefined,
      });
    }
    throw new Error('Outlook API retry limit reached');
  };
  const messageFields = 'id,conversationId,internetMessageId,subject,body,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients,bccRecipients,replyTo,internetMessageHeaders,categories,isRead,isDraft,hasAttachments,parentFolderId';
  const allPages = async <T>(path: string) => {
    const values: T[] = [];
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      if (seen.has(path)) throw new Error('Outlook API pagination repeated a continuation URL');
      seen.add(path);
      const page = await request<GraphPage<T>>(path);
      values.push(...(page.value ?? []));
      if (!page['@odata.nextLink']) return values;
      path = page['@odata.nextLink'];
    }
    throw new Error('Outlook API pagination exceeds the safe page limit');
  };
  let folderIds: Promise<OutlookFolderIds> | undefined;
  const folders = () => folderIds ??= (async () => {
    const entries = await Promise.all((['inbox', 'deleteditems', 'junkemail', 'sentitems'] as const).map(async (name) => {
      const folder = await request<{ id: string }>(`me/mailFolders/${name}?$select=id`);
      return [name, folder.id] as const;
    }));
    const byName = Object.fromEntries(entries);
    return { inbox: byName.inbox, trash: byName.deleteditems, junk: byName.junkemail, sent: byName.sentitems };
  })();
  const listConversation = async (conversationId: string) => {
    const filter = conversationId.replace(/'/g, "''");
    const query = new URLSearchParams({ '$filter': `conversationId eq '${filter}'`, '$select': messageFields, '$top': '100' });
    return (await allPages<GraphMessage>(`me/messages?${query}`)).filter(({ isDraft }) => !isDraft);
  };
  const findByInternetId = async (messageId: string) => {
    const filter = messageId.replace(/'/g, "''");
    const query = new URLSearchParams({ '$filter': `internetMessageId eq '${filter}'`, '$select': 'id,conversationId', '$top': '1' });
    return (await request<GraphPage<GraphMessage>>(`me/messages?${query}`)).value?.[0] ?? null;
  };
  const mutateConversation = async (conversationId: string, patch: Record<string, unknown>) => boundedMap(await listConversation(conversationId), (message) => request(`me/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify(patch) }));
  return {
    async profile() { return { emailAddress: ownEmail, messagesTotal: 0, threadsTotal: 0, historyId: initialDeltaCursor() }; },
    async listThreads(maxResults = 100, pageToken?: string) {
      const limit = z.number().int().min(1).max(500).parse(maxResults);
      let state: z.infer<typeof listCursorSchema>;
      if (pageToken) {
        try { state = listCursorSchema.parse(decodeCursor(pageToken, 'list')); }
        catch { throw new Error('Invalid Outlook list cursor'); }
      } else state = { v: 2, k: 'outlook-list', i: 0, n: initialFolderUrl(OUTLOOK_FOLDERS[0], 'list', Math.min(limit, 100)), q: [], x: [], p: 0 };
      const threads: Array<{ id: string }> = [];
      while (threads.length < limit) {
        while (state.q.length && threads.length < limit) {
          threads.push({ id: state.q.shift()! });
        }
        if (threads.length >= limit || !state.n) break;
        const folder = OUTLOOK_FOLDERS[state.i];
        validateFolderUrl(state.n, folder, 'list');
        const currentHash = cursorHash(state.n);
        if (state.x.includes(currentHash)) throw new Error('Outlook list pagination repeated a continuation URL');
        const consumed = [...state.x, currentHash].slice(-RECENT_CONTINUATION_COUNT);
        state.p += 1;
        if (state.p > MAX_FOLDER_PAGES) throw new Error('Outlook list pagination exceeds the safe folder page limit');
        const page = await request<GraphPage<GraphMessage>>(state.n);
        const pageIds = (page.value ?? []).filter((message) => !message.isDraft && message.conversationId).map((message) => message.conversationId);
        const available = limit - threads.length;
        for (const id of pageIds.slice(0, available)) threads.push({ id });
        state.q = pageIds.slice(available);
        const next = page['@odata.nextLink'];
        if (next) {
          validateFolderUrl(next, folder, 'list');
          if (consumed.includes(cursorHash(next))) throw new Error('Outlook list pagination repeated a continuation URL');
          state.n = next;
          state.x = consumed;
        } else if (state.i < OUTLOOK_FOLDERS.length - 1) {
          state.i += 1;
          state.n = initialFolderUrl(OUTLOOK_FOLDERS[state.i], 'list', Math.min(limit, 100));
          state.x = [];
          state.p = 0;
        } else {
          state.n = null;
          state.x = [];
          state.p = 0;
        }
      }
      const hasMore = Boolean(state.q.length || state.n);
      return { threads, ...(hasMore ? { nextPageToken: encodeCursor(listCursorSchema.parse(state)) } : {}) };
    },
    async history(startHistoryId: string, pageToken?: string) {
      // Previously persisted Inbox-only cursors must trigger the canonical full-sync fallback once.
      if (isLegacyDeltaCursor(startHistoryId)) throw new OutlookApiError(410, { code: 'syncStateNotFound' });
      let initial: z.infer<typeof deltaCursorSchema>;
      try { initial = deltaCursorSchema.parse(decodeCursor(startHistoryId, 'delta')); validateDeltaFolders(initial.f); }
      catch { throw new Error('Invalid Outlook delta cursor'); }
      let state: z.infer<typeof deltaPageCursorSchema>;
      if (pageToken) {
        try { state = deltaPageCursorSchema.parse(decodeCursor(pageToken, 'delta page')); validateDeltaFolders(state.f); }
        catch { throw new Error('Invalid Outlook delta page cursor'); }
        if (state.b !== cursorHash(startHistoryId, 32)) throw new Error('Outlook delta page cursor does not match its history cursor');
      } else {
        state = {
          v: 2, k: 'outlook-delta-page', b: cursorHash(startHistoryId, 32), i: 0,
          n: initial.f.inbox ?? initialFolderUrl('inbox', 'delta', 1000), f: { ...initial.f }, x: [], p: 0,
        };
      }
      const folder = OUTLOOK_FOLDERS[state.i];
      validateFolderUrl(state.n, folder, 'delta');
      const currentHash = cursorHash(state.n);
      if (state.x.includes(currentHash)) throw new Error('Outlook delta pagination repeated a continuation URL');
      const consumed = [...state.x, currentHash].slice(-RECENT_CONTINUATION_COUNT);
      state.p += 1;
      if (state.p > MAX_FOLDER_PAGES) throw new Error('Outlook delta pagination exceeds the safe folder page limit');
      let effectiveUrl = state.n;
      let page: GraphPage<GraphMessage>;
      try { page = await request<GraphPage<GraphMessage>>(effectiveUrl); }
      catch (error) {
        if (!(error instanceof OutlookApiError) || error.status !== 410 || error.code?.toLowerCase() !== 'syncstatenotfound' || !error.resetUrl) throw error;
        effectiveUrl = validateFolderUrl(error.resetUrl, folder, 'delta');
        page = await request<GraphPage<GraphMessage>>(effectiveUrl);
        if (!consumed.includes(cursorHash(effectiveUrl))) {
          consumed.push(cursorHash(effectiveUrl));
          if (consumed.length > RECENT_CONTINUATION_COUNT) consumed.shift();
        }
      }
      const history = (page.value ?? []).filter((message) => message['@removed'] || !message.isDraft).map((message) => message['@removed']
        ? { id: message.id, messagesDeleted: [{ message: { id: message.id, threadId: '' } }] }
        : { id: message.id, messagesAdded: [{ message: { id: message.id, threadId: message.conversationId } }] });
      const next = page['@odata.nextLink'];
      if (next) {
        validateFolderUrl(next, folder, 'delta');
        if (consumed.includes(cursorHash(next))) throw new Error('Outlook delta pagination repeated a continuation URL');
        state.n = next;
        state.x = consumed;
        return { history, nextPageToken: encodeCursor(deltaPageCursorSchema.parse(state)) };
      }
      const delta = page['@odata.deltaLink'];
      if (!delta) throw new Error('Outlook delta response did not include a continuation or delta link');
      state.f[folder] = validateFolderUrl(delta, folder, 'delta');
      if (state.i < OUTLOOK_FOLDERS.length - 1) {
        state.i += 1;
        const nextFolder = OUTLOOK_FOLDERS[state.i];
        state.n = state.f[nextFolder] ?? initialFolderUrl(nextFolder, 'delta', 1000);
        state.x = [];
        state.p = 0;
        return { history, nextPageToken: encodeCursor(deltaPageCursorSchema.parse(state)) };
      }
      const completed = deltaCursorSchema.parse({ v: 1, k: 'outlook-delta', f: state.f });
      if (OUTLOOK_FOLDERS.some((name) => !completed.f[name])) throw new Error('Outlook delta round did not complete every folder');
      return { history, historyId: encodeCursor(completed) };
    },
    async threadMetadata(id: string): Promise<GmailThreadResource> {
      const messages = await listConversation(id);
      if (!messages.length) throw new OutlookApiError(404);
      return { id, messages: messages.map((message) => ({ id: message.id, threadId: id })) };
    },
    async message(id: string) { return graphMessage(await request<GraphMessage>(`me/messages/${encodeURIComponent(id)}?$select=${messageFields}`), ownEmail, await folders()); },
    async findMessageByRfc822Id(messageId: string) { const found = await findByInternetId(messageId); return found ? { id: found.id, threadId: found.conversationId } : null; },
    async modifyThread(id: string, addLabelIds: string[], removeLabelIds: string[]) {
      if (addLabelIds.includes('UNREAD') || removeLabelIds.includes('UNREAD')) await mutateConversation(id, { isRead: removeLabelIds.includes('UNREAD') });
      if (addLabelIds.includes('STARRED') || removeLabelIds.includes('STARRED')) {
        const messages = await listConversation(id);
        await boundedMap(messages, (message) => request(`me/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ categories: addLabelIds.includes('STARRED') ? [...new Set([...(message.categories ?? []), OUTLOOK_STAR_CATEGORY])] : (message.categories ?? []).filter((category) => category !== OUTLOOK_STAR_CATEGORY) }) }));
      }
    },
    async trashThread(id: string) {
      const moved = await boundedMap(await listConversation(id), (message) => request<GraphMessage>(`me/messages/${encodeURIComponent(message.id)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: 'deleteditems' }) }));
      return { id, messages: moved.filter((message): message is GraphMessage => Boolean(message?.id)).map((message) => ({ id: message.id, threadId: message.conversationId || id })) };
    },
    async listTrashMessages(maxResults = 500, pageToken?: string) {
      const page = await request<GraphPage<GraphMessage>>(pageToken ?? `me/mailFolders/deleteditems/messages?$select=id,conversationId&$top=${Math.min(maxResults, 500)}`);
      return { messages: (page.value ?? []).map(({ id, conversationId }) => ({ id, threadId: conversationId })), ...(page['@odata.nextLink'] ? { nextPageToken: page['@odata.nextLink'] } : {}) };
    },
    async batchDeleteMessages(ids: string[]) {
      const results = await settledMap([...new Set(ids)], (id) => request(`me/messages/${encodeURIComponent(id)}/permanentDelete`, { method: 'POST' }));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected' && !(result.reason instanceof OutlookApiError && result.reason.status === 404));
      if (failed) throw failed.reason;
    },
    async sendRaw(raw: string) {
      const id = /(?:^|\r?\n)Message-ID:\s*(<[^\r\n]+>)/i.exec(raw)?.[1];
      if (!id) throw new Error('Outgoing message ID is required');
      await request('me/sendMail', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: Buffer.from(raw).toString('base64') });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const found = await findByInternetId(id);
        if (found) return { id: found.id, threadId: found.conversationId };
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      throw new Error('Outlook accepted the email but its sent message is not available yet');
    },
    async watch() { throw new Error('Outlook push subscriptions are not configured'); },
    async stop() {},
    async revoke() {},
  };
}

export type OutlookClient = ReturnType<typeof createOutlookClient>;
