import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { EmailConnectorCredentials } from './connector-schema';

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(), token_type: z.string().min(1).default('Bearer'),
  scope: z.string().optional(), id_token: z.string().optional(),
}).passthrough();
const identitySchema = z.object({
  sub: z.string().min(1), email: z.string().email(), email_verified: z.union([z.literal('true'), z.literal(true)]),
  aud: z.string().min(1), iss: z.string().min(1), exp: z.coerce.number().int().positive(), nonce: z.string().min(1),
}).passthrough();
const profileSchema = z.object({ emailAddress: z.string().email(), messagesTotal: z.number().int().nonnegative(), threadsTotal: z.number().int().nonnegative(), historyId: z.string().min(1) }).passthrough();

function oauthConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const clientId = environment.GMAIL_OAUTH_CLIENT_ID ?? environment.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = environment.GMAIL_OAUTH_CLIENT_SECRET ?? environment.GOOGLE_OAUTH_CLIENT_SECRET;
  const origin = environment.BACKEND_PUBLIC_URL ?? 'http://localhost:3001';
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth is not configured');
  return { clientId, clientSecret, redirectUri: environment.GMAIL_OAUTH_REDIRECT_URI ?? new URL('/api/v1/auth/mobile/oauth/google/callback', origin).toString() };
}

function form(input: Record<string, string>) { return new URLSearchParams(input).toString(); }
export function createPkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildGmailAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }, environment: NodeJS.ProcessEnv = process.env) {
  const config = oauthConfiguration(environment);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeGmailCode(code: string, verifier: string, nonce: string, fetcher: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
  const config = oauthConfiguration(environment);
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }),
  });
  const token = tokenSchema.parse(await response.json());
  if (!response.ok || !token.id_token) throw new Error('Gmail authorization code exchange failed');
  const identityResponse = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`);
  const identity = identitySchema.parse(await identityResponse.json());
  const issuerValid = identity.iss === 'https://accounts.google.com' || identity.iss === 'accounts.google.com';
  if (!identityResponse.ok || identity.aud !== config.clientId || identity.nonce !== nonce || !issuerValid || identity.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Gmail identity token validation failed');
  }
  return {
    identity: { providerAccountId: identity.sub, email: identity.email.toLowerCase() },
    scopes: (token.scope ?? GMAIL_SCOPES.join(' ')).split(' ').filter(Boolean),
    credentials: {
      accessToken: token.access_token, refreshToken: token.refresh_token, tokenType: token.token_type,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    } satisfies EmailConnectorCredentials,
  };
}

export async function refreshGmailCredentials(credentials: EmailConnectorCredentials, fetcher: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
  if (!credentials.refreshToken) throw new Error('Gmail refresh token is unavailable');
  const config = oauthConfiguration(environment);
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ refresh_token: credentials.refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' }),
  });
  const token = tokenSchema.parse(await response.json());
  if (!response.ok) throw new Error('Gmail token refresh failed');
  return emailCredentials(token, credentials.refreshToken);
}

function emailCredentials(token: z.infer<typeof tokenSchema>, refreshToken?: string): EmailConnectorCredentials {
  return {
    accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken, tokenType: token.token_type,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  };
}

export interface GmailHeader { name: string; value: string }
export interface GmailPart { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string }; parts?: GmailPart[] }
export interface GmailMessageResource { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }
export interface GmailThreadResource { id: string; historyId?: string; messages?: GmailMessageResource[] }
export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: Array<{ message: Pick<GmailMessageResource, 'id' | 'threadId'> }>;
  labelsAdded?: Array<{ message: Pick<GmailMessageResource, 'id' | 'threadId'> }>;
  labelsRemoved?: Array<{ message: Pick<GmailMessageResource, 'id' | 'threadId'> }>;
  messagesDeleted?: Array<{ message: Pick<GmailMessageResource, 'id' | 'threadId'> }>;
}

export class GmailApiError extends Error {
  constructor(readonly status: number) { super(`Gmail API request failed (${status})`); }
}

export function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function emailAddresses(value: string): string[] {
  return [...value.matchAll(/(?:^|,)\s*(?:"[^"]*"\s*)?(?:<)?([^\s,<>"]+@[^\s,<>"]+)(?:>)?/g)]
    .map((match) => match[1]!.toLowerCase()).filter((email) => z.string().email().safeParse(email).success);
}

function decodeBody(data?: string) {
  if (!data) return '';
  try { return Buffer.from(data, 'base64url').toString('utf8'); } catch { return ''; }
}

export function messageBodies(part: GmailPart | undefined): { text: string; html?: string; hasAttachments: boolean } {
  if (!part) return { text: '', hasAttachments: false };
  let text = part.mimeType === 'text/plain' ? decodeBody(part.body?.data) : '';
  let html = part.mimeType === 'text/html' ? decodeBody(part.body?.data) : '';
  let hasAttachments = Boolean(part.filename);
  for (const child of part.parts ?? []) {
    const nested = messageBodies(child);
    text ||= nested.text;
    html ||= nested.html ?? '';
    hasAttachments ||= nested.hasAttachments;
  }
  return { text: text.trim(), html: html.trim() || undefined, hasAttachments };
}

export function createGmailClient(accessToken: string, fetcher: typeof fetch = fetch) {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...init, headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init?.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new GmailApiError(response.status);
    return body as T;
  };
  return {
    profile: () => request<z.infer<typeof profileSchema>>('/profile').then((value) => profileSchema.parse(value)),
    async listThreads(maxResults = 100, pageToken?: string) {
      const query = new URLSearchParams({ maxResults: String(maxResults), includeSpamTrash: 'true' });
      if (pageToken) query.set('pageToken', pageToken);
      return request<{ threads?: Array<{ id: string }>; nextPageToken?: string }>(`/threads?${query}`);
    },
    async history(startHistoryId: string, pageToken?: string) {
      const query = new URLSearchParams({ startHistoryId, maxResults: '500' });
      for (const type of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) query.append('historyTypes', type);
      if (pageToken) query.set('pageToken', pageToken);
      return request<{ history?: GmailHistoryRecord[]; nextPageToken?: string; historyId?: string }>(`/history?${query}`);
    },
    watch: (topicName: string) => request<{ historyId: string; expiration: string }>('/watch', { method: 'POST', body: JSON.stringify({ topicName }) }),
    stop: () => request<unknown>('/stop', { method: 'POST', body: '{}' }),
    threadMetadata: (id: string) => request<GmailThreadResource>(`/threads/${encodeURIComponent(id)}?format=minimal`),
    message: (id: string) => request<GmailMessageResource>(`/messages/${encodeURIComponent(id)}?format=full`),
    async findMessageByRfc822Id(messageId: string) {
      const query = new URLSearchParams({ q: `rfc822msgid:${messageId}`, maxResults: '1' });
      return (await request<{ messages?: Array<{ id: string; threadId: string }> }>(`/messages?${query}`)).messages?.[0] ?? null;
    },
    modifyThread: (id: string, addLabelIds: string[], removeLabelIds: string[]) => request(`/threads/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds, removeLabelIds }) }),
    sendRaw: (raw: string, threadId: string) => request<{ id: string; threadId: string }>('/messages/send', { method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url'), threadId }) }),
    async revoke() {
      await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: accessToken }).toString() });
    },
  };
}

export type GmailClient = ReturnType<typeof createGmailClient>;
