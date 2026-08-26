import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { EmailConnectorCredentials, OAuthEmailConnectorCredentials } from './connector-schema';

export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://mail.google.com/',
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

export async function refreshGmailCredentials(credentials: OAuthEmailConnectorCredentials, fetcher: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
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
export interface GmailPart { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { attachmentId?: string; data?: string; size?: number }; parts?: GmailPart[] }
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
  constructor(readonly status: number, readonly reasons: string[] = [], readonly metadata: {
    providerStatus?: string;
    providerMessage?: string;
    retryAfterMs?: number;
    details?: unknown;
  } = {}) {
    super(metadata.providerMessage ? `Gmail API request failed (${status}): ${metadata.providerMessage}` : `Gmail API request failed (${status})`);
    this.name = 'GmailApiError';
  }
}

export type GmailPermanentAttachmentErrorCode = 'ATTACHMENT_INVALID_BASE64URL' | 'ATTACHMENT_INVALID_IDENTIFIER' | 'ATTACHMENT_INVALID_SIZE' | 'ATTACHMENT_MALFORMED_PAYLOAD' | 'ATTACHMENT_SIZE_MISMATCH';

export class GmailPermanentAttachmentError extends Error {
  readonly permanent = true;

  constructor(readonly code: GmailPermanentAttachmentErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GmailPermanentAttachmentError';
  }
}

const RETRYABLE_GMAIL_REASONS = new Set(['backendError', 'internalError', 'quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE']);
const RETRYABLE_TRANSPORT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN']);
export function isRetryableGmailError(error: unknown) {
  return error instanceof GmailApiError
    && (error.status === 408 || error.status === 429 || error.status >= 500 || (error.status === 403 && error.reasons.some((reason) => RETRYABLE_GMAIL_REASONS.has(reason))));
}

function isRetryableTransportError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) return error.name === 'AbortError' || error.name === 'NetworkError' || error.name === 'TimeoutError';
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && RETRYABLE_TRANSPORT_CODES.has(error.code);
}

export function header(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function emailAddresses(value: string): string[] {
  return [...value.matchAll(/<\s*([^\s,<>"]+@[^\s,<>"]+)\s*>|(?:^|,)\s*([^\s,<>"]+@[^\s,<>"]+)/g)]
    .map((match) => (match[1] ?? match[2])!.toLowerCase()).filter((email) => z.string().email().safeParse(email).success);
}

export function decodeRfc2047Words(value: string) {
  const joined = value.replace(/(\?=)\s+(?==\?)/g, '$1');
  return joined.replace(/=\?([^?\s]+)\?([bq])\?([^?]*)\?=/gi, (encoded, charset: string, encoding: string, content: string) => {
    try {
      let bytes: Uint8Array;
      if (encoding.toLowerCase() === 'b') bytes = Buffer.from(content, 'base64');
      else {
        const output: number[] = [];
        const normalized = content.replace(/_/g, ' ');
        for (let index = 0; index < normalized.length; index += 1) {
          if (normalized[index] === '=' && /^[0-9a-f]{2}$/i.test(normalized.slice(index + 1, index + 3))) {
            output.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
            index += 2;
          } else output.push(normalized.charCodeAt(index));
        }
        bytes = Uint8Array.from(output);
      }
      return new TextDecoder(charset).decode(bytes);
    } catch { return encoded; }
  });
}

export function emailAddressWithName(value: string): { email?: string; name?: string } {
  const sanitized = value.replace(/[\r\n\0-\x1f\x7f]+/g, ' ');
  const email = emailAddresses(sanitized)[0];
  if (!email) return {};
  const angle = sanitized.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
  if (!angle) return { email };
  const raw = decodeRfc2047Words(angle[1]!.trim().replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1'));
  const name = raw.replace(/[\r\n\0-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
  return { email, ...(name ? { name } : {}) };
}

const MAX_GMAIL_BODY_BYTES = 25 * 1024 * 1024;
const MAX_GMAIL_BODY_BASE64_CHARACTERS = Math.ceil(MAX_GMAIL_BODY_BYTES / 3) * 4 + 4;
export const MAX_GMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_GMAIL_ATTACHMENT_BASE64_CHARACTERS = Math.ceil(MAX_GMAIL_ATTACHMENT_BYTES / 3) * 4 + 4;
export const MAX_GMAIL_ATTACHMENTS = 20;
const MAX_GMAIL_MIME_DEPTH = 100;
const MAX_GMAIL_MIME_NODES = 10_000;
const DOCUMENT_MIME_TYPES = new Map<string, string>([
  ['application/pdf', 'pdf'], ['text/plain', 'txt'], ['text/markdown', 'md'], ['text/x-markdown', 'md'], ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
] as const);
const IMAGE_MIME_TYPES = new Map<string, string>([['image/jpeg', 'jpg'], ['image/jpg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
const INVALID_ATTACHMENT_FILENAME = /[<>:"/\\|?*\p{Cc}\p{Cf}]/u;
const RESERVED_ATTACHMENT_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface GmailAttachmentPart {
  path: string;
  type: 'document' | 'image';
  mimeType: string;
  filename: string;
  size: number;
  attachmentId?: string;
  data?: string;
}

export interface GmailAttachmentDiscovery {
  parts: GmailAttachmentPart[];
  truncated: boolean;
  unavailableCount: number;
}

export function normalizeGmailAttachmentFilename(filename: string | undefined, path: string, mimeType: string) {
  const extension = DOCUMENT_MIME_TYPES.get(mimeType) ?? IMAGE_MIME_TYPES.get(mimeType);
  if (!extension) throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail attachment MIME type is unsupported');
  const fallback = () => `attachment-${createHash('sha256').update(path).digest('hex').slice(0, 12)}.${extension}`;
  const normalized = (filename ?? '').normalize('NFC').trim();
  if (!normalized || normalized === '.' || normalized === '..' || INVALID_ATTACHMENT_FILENAME.test(normalized) || RESERVED_ATTACHMENT_FILENAME.test(normalized) || normalized.endsWith('.') || Buffer.byteLength(normalized) > 255) return fallback();
  const lastDot = normalized.lastIndexOf('.');
  const stem = (lastDot > 0 ? normalized.slice(0, lastDot) : normalized).trim();
  if (!stem || stem === '.' || stem === '..' || RESERVED_ATTACHMENT_FILENAME.test(stem)) return fallback();
  const canonical = `${stem}.${extension}`;
  return Buffer.byteLength(canonical) <= 255 ? canonical : fallback();
}

/** Discovers supported leaf attachments and reports every bounded omission. */
export function discoverGmailAttachmentParts(root: GmailPart | undefined): GmailAttachmentDiscovery {
  const attachments: GmailAttachmentPart[] = [];
  if (!root) return { parts: attachments, truncated: false, unavailableCount: 0 };
  const pending: Array<{ part: GmailPart; path: string; depth: number }> = [{ part: root, path: '0', depth: 0 }];
  let nodes = 0;
  let supported = 0;
  let advertisedBytes = 0;
  let unavailableCount = 0;
  let truncated = false;
  while (pending.length && nodes < MAX_GMAIL_MIME_NODES) {
    const { part, path, depth } = pending.pop()!;
    nodes += 1;
    const mimeType = (part.mimeType ?? '').trim().toLowerCase().split(';', 1)[0]!;
    const filename = part.filename ?? '';
    const attached = Boolean(filename.trim()) || /^\s*attachment(?:\s*;|\s*$)/i.test(header(part.headers, 'content-disposition'));
    if (mimeType === 'message/rfc822') {
      if (attached) { unavailableCount += 1; truncated = true; }
      continue;
    }
    if (attached) {
      const documentExtension = DOCUMENT_MIME_TYPES.get(mimeType);
      const type = documentExtension ? 'document' as const : IMAGE_MIME_TYPES.has(mimeType) ? 'image' as const : null;
      if (type) {
        supported += 1;
        const safeFilename = normalizeGmailAttachmentFilename(filename, path, mimeType);
        const size = Number.isSafeInteger(part.body?.size) ? part.body!.size! : -1;
        if (supported > MAX_GMAIL_ATTACHMENTS || (size >= 0 && advertisedBytes + size > MAX_GMAIL_ATTACHMENT_BYTES)) {
          unavailableCount += 1;
          truncated = true;
          continue;
        }
        if (size >= 0) advertisedBytes += size;
        attachments.push({ path, type, mimeType, filename: safeFilename, size, ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}), ...(part.body?.data !== undefined ? { data: part.body.data } : {}) });
      } else {
        unavailableCount += 1;
        truncated = true;
      }
      continue;
    }
    if (depth >= MAX_GMAIL_MIME_DEPTH) {
      if (part.parts?.length) { unavailableCount += 1; truncated = true; }
      continue;
    }
    const children = part.parts ?? [];
    const remainingNodeBudget = MAX_GMAIL_MIME_NODES - nodes - pending.length;
    const retainedChildren = Math.min(children.length, Math.max(0, remainingNodeBudget));
    if (retainedChildren < children.length) { unavailableCount += 1; truncated = true; }
    for (let index = retainedChildren - 1; index >= 0; index -= 1) pending.push({ part: children[index]!, path: `${path}.${index}`, depth: depth + 1 });
  }
  if (pending.length) { unavailableCount += 1; truncated = true; }
  return { parts: attachments, truncated, unavailableCount: Math.min(unavailableCount, MAX_GMAIL_MIME_NODES) };
}

/** Returns retained parts for callers that do not need availability metadata. */
export function gmailAttachmentParts(root: GmailPart | undefined): GmailAttachmentPart[] {
  return discoverGmailAttachmentParts(root).parts;
}

export function decodeGmailAttachmentData(data: string, expectedSize: number): Uint8Array {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_GMAIL_ATTACHMENT_BYTES) throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_SIZE', 'Gmail attachment size is invalid');
  const unpadded = data.replace(/=+$/, '');
  const padding = data.length - unpadded.length;
  const requiredPadding = (4 - unpadded.length % 4) % 4;
  if (!/^(?:[A-Za-z0-9_-]+={0,2})?$/.test(data) || data.length > MAX_GMAIL_ATTACHMENT_BASE64_CHARACTERS || unpadded.length % 4 === 1 || (padding > 0 && padding !== requiredPadding)) throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_BASE64URL', 'Gmail attachment data is not valid base64url');
  const bytes = new Uint8Array(Buffer.from(unpadded, 'base64url'));
  if (bytes.byteLength !== expectedSize) throw new GmailPermanentAttachmentError('ATTACHMENT_SIZE_MISMATCH', 'Gmail attachment size did not match the provider metadata');
  const canonical = Buffer.from(bytes).toString('base64url');
  if (canonical !== unpadded) throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_BASE64URL', 'Gmail attachment data is not canonical base64url');
  return bytes;
}

function validateGmailAttachmentPayload(part: GmailAttachmentPart, bytes: Uint8Array) {
  if (part.type !== 'image') return bytes;
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString('ascii');
  const matches = part.mimeType === 'image/jpeg' || part.mimeType === 'image/jpg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : part.mimeType === 'image/png'
      ? bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
      : part.mimeType === 'image/gif'
        ? ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'
        : part.mimeType === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!matches) throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail image attachment does not match its declared MIME type');
  return bytes;
}

function isAttachedPart(part: GmailPart) {
  return part.mimeType?.toLowerCase() === 'message/rfc822'
    || Boolean(part.filename)
    || /^\s*attachment(?:\s*;|\s*$)/i.test(header(part.headers, 'content-disposition'));
}

function decodeBody(data: string | undefined, headers: GmailHeader[] | undefined) {
  if (!data) return '';
  try {
    if (data.length > MAX_GMAIL_BODY_BASE64_CHARACTERS) return '';
    const bytes = Buffer.from(data, 'base64url');
    if (bytes.byteLength > MAX_GMAIL_BODY_BYTES) return '';
    const contentType = header(headers, 'content-type');
    const charset = contentType.match(/\bcharset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
    try { return new TextDecoder(charset ?? 'utf-8').decode(bytes); }
    catch { return new TextDecoder().decode(bytes); }
  } catch { return ''; }
}

export function messageBodies(part: GmailPart | undefined): { text: string; html?: string; hasAttachments: boolean } {
  if (!part) return { text: '', hasAttachments: false };
  if (isAttachedPart(part)) return { text: '', hasAttachments: true };
  let text = part.mimeType?.toLowerCase() === 'text/plain' ? decodeBody(part.body?.data, part.headers) : '';
  let html = part.mimeType?.toLowerCase() === 'text/html' ? decodeBody(part.body?.data, part.headers) : '';
  let hasAttachments = false;
  for (const child of part.parts ?? []) {
    const nested = messageBodies(child);
    text ||= nested.text;
    html ||= nested.html ?? '';
    hasAttachments ||= nested.hasAttachments;
  }
  return { text: text.trim(), html: html.trim() || undefined, hasAttachments };
}

export function createGmailClient(accessToken: string, fetcher: typeof fetch = fetch, options: {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  maxConcurrency?: number;
} = {}) {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const maxConcurrency = Math.max(1, Math.min(20, Math.trunc(options.maxConcurrency ?? 6)));
  let activeRequests = 0;
  const waiting: Array<() => void> = [];
  const limitedFetch = async (input: string, init: RequestInit) => {
    if (activeRequests >= maxConcurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    activeRequests += 1;
    try { return await fetcher(input, init); }
    finally {
      activeRequests -= 1;
      waiting.shift()?.();
    }
  };
  const retryAfter = (value: string | null) => {
    if (!value) return undefined;
    if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - now()) : undefined;
  };
  const request = async <T>(path: string, init?: RequestInit, retry = true): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await limitedFetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
          ...init, signal: init?.signal ?? AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init?.headers },
        });
      } catch (error) {
        if (!retry || attempt >= 3 || init?.signal?.aborted || !isRetryableTransportError(error)) throw error;
        await sleep(Math.floor(random() * 250 * (2 ** attempt)));
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.ok) return body as T;
      const providerError = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' ? body.error : null;
      const providerStatus = providerError && 'status' in providerError && typeof providerError.status === 'string' ? providerError.status : undefined;
      const reasons = z.array(z.string()).catch([]).parse([
        ...(providerError && 'errors' in providerError && Array.isArray(providerError.errors) ? providerError.errors.flatMap((item: unknown) => item && typeof item === 'object' && 'reason' in item && typeof item.reason === 'string' ? [item.reason] : []) : []),
        ...(providerStatus ? [providerStatus] : []),
      ]);
      const error = new GmailApiError(response.status, reasons, {
        providerStatus,
        providerMessage: providerError && 'message' in providerError && typeof providerError.message === 'string' ? providerError.message : undefined,
        retryAfterMs: retryAfter(response.headers.get('retry-after')),
        details: body,
      });
      if (!retry || attempt >= 3 || !isRetryableGmailError(error)) throw error;
      await sleep(error.metadata.retryAfterMs ?? Math.floor(random() * 250 * (2 ** attempt)));
    }
  };
  const hydrateTextAttachments = async (messageId: string, part: GmailPart | undefined) => {
    let totalBytes = 0;
    const visit = async (current: GmailPart) => {
      if (isAttachedPart(current)) return;
      const attachmentId = current.body?.attachmentId;
      if ((current.mimeType === 'text/plain' || current.mimeType === 'text/html') && attachmentId && !current.body?.data) {
        const advertisedSize = current.body?.size ?? 0;
        if (totalBytes + advertisedSize > MAX_GMAIL_BODY_BYTES) throw new RangeError('Gmail text MIME attachments exceed the 25 MB limit');
        const attachment = await request<{ data: string; size?: number }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        if (typeof attachment.data !== 'string') throw new TypeError('Gmail text MIME attachment data is invalid');
        if (attachment.data.length > MAX_GMAIL_BODY_BASE64_CHARACTERS) throw new RangeError('Gmail text MIME attachments exceed the 25 MB limit');
        const bytes = Buffer.from(attachment.data, 'base64url').byteLength;
        totalBytes += bytes;
        if (totalBytes > MAX_GMAIL_BODY_BYTES) throw new RangeError('Gmail text MIME attachments exceed the 25 MB limit');
        current.body = { ...current.body, data: attachment.data, size: attachment.size ?? bytes };
      }
      for (const child of current.parts ?? []) await visit(child);
    };
    if (part) await visit(part);
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
    async message(id: string) {
      const message = await request<GmailMessageResource>(`/messages/${encodeURIComponent(id)}?format=full`);
      await hydrateTextAttachments(id, message.payload);
      return message;
    },
    async attachment(messageId: string, part: GmailAttachmentPart) {
      if (!part.filename || Buffer.byteLength(part.filename) > 255 || INVALID_ATTACHMENT_FILENAME.test(part.filename)) throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail attachment filename is invalid');
      if (part.type === 'image' && part.size > 20 * 1024 * 1024) throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_SIZE', 'Gmail image attachment exceeds the canonical size limit');
      if (part.data !== undefined) return validateGmailAttachmentPayload(part, decodeGmailAttachmentData(part.data, part.size));
      if (!part.attachmentId) throw new GmailPermanentAttachmentError('ATTACHMENT_INVALID_IDENTIFIER', 'Gmail attachment identifier is missing');
      const attachment = await request<{ data?: unknown; size?: unknown }>(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.attachmentId)}`);
      if (typeof attachment.data !== 'string') throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail attachment data is invalid');
      if (attachment.size !== undefined && (!Number.isSafeInteger(attachment.size) || attachment.size !== part.size)) throw new GmailPermanentAttachmentError('ATTACHMENT_SIZE_MISMATCH', 'Gmail attachment provider sizes did not match');
      return validateGmailAttachmentPayload(part, decodeGmailAttachmentData(attachment.data, part.size));
    },
    async findMessageByRfc822Id(messageId: string) {
      const query = new URLSearchParams({ q: `rfc822msgid:${messageId}`, maxResults: '1' });
      return (await request<{ messages?: Array<{ id: string; threadId: string }> }>(`/messages?${query}`)).messages?.[0] ?? null;
    },
    modifyThread: (id: string, addLabelIds: string[], removeLabelIds: string[]) => request(`/threads/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds, removeLabelIds }) }),
    trashThread: (id: string) => request<GmailThreadResource>(`/threads/${encodeURIComponent(id)}/trash`, { method: 'POST', body: '{}' }),
    async listTrashMessages(maxResults = 500, pageToken?: string) {
      const bounded = Math.max(1, Math.min(500, Math.trunc(maxResults)));
      const query = new URLSearchParams({ labelIds: 'TRASH', includeSpamTrash: 'true', maxResults: String(bounded) });
      if (pageToken) query.set('pageToken', pageToken);
      return request<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(`/messages?${query}`);
    },
    batchDeleteMessages: (ids: string[]) => request<unknown>('/messages/batchDelete', { method: 'POST', body: JSON.stringify({ ids: z.array(z.string().min(1)).min(1).max(500).parse(ids) }) }),
    sendRaw: (raw: string, threadId?: string) => request<{ id: string; threadId: string }>('/messages/send', { method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url'), ...(threadId ? { threadId } : {}) }) }, false),
    async revoke() {
      await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: accessToken }).toString() });
    },
  };
}

export type GmailClient = ReturnType<typeof createGmailClient>;
