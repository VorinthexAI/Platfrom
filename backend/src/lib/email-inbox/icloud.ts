import { createHash } from 'node:crypto';
import { ImapFlow, type FetchMessageObject, type ListResponse } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { ICloudEmailConnectorCredentials } from './connector-schema';
import type { GmailMessageResource, GmailThreadResource } from './gmail';

const locatorSchema = z.object({ mailbox: z.string().min(1), validity: z.string().regex(/^\d+$/), uid: z.number().int().positive() }).strict();
type Locator = z.infer<typeof locatorSchema>;

function encodedLocator(value: Locator) { return Buffer.from(JSON.stringify(locatorSchema.parse(value))).toString('base64url'); }
function decodedLocator(value: string) { return locatorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); }
function mailboxByUse(mailboxes: ListResponse[], use: '\\Sent' | '\\Trash', fallback: string) { return mailboxes.find(({ specialUse }) => specialUse === use)?.path ?? fallback; }
type MailboxRole = 'inbox' | 'sent' | 'trash' | 'other';
export function iCloudMailboxRole(mailboxes: ListResponse[], path: string): MailboxRole {
  if (path.toUpperCase() === 'INBOX') return 'inbox';
  const use = mailboxes.find((mailbox) => mailbox.path === path)?.specialUse;
  return use === '\\Sent' ? 'sent' : use === '\\Trash' ? 'trash' : 'other';
}
function addressList(value: { value?: Array<{ address?: string; name?: string }> } | undefined) { return (value?.value ?? []).map(({ address, name }) => address ? name ? `${name} <${address}>` : address : '').filter(Boolean).join(', '); }
function rawHeaders(raw: string, name: string) {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0]?.replace(/\r?\n[ \t]+/g, ' ') ?? '';
  return headerBlock.split(/\r?\n/).flatMap((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`) ? [line.slice(line.indexOf(':') + 1).trim()] : []);
}
export function iCloudSmtpPayload(raw: string, from: string) {
  const to = ['To', 'Cc', 'Bcc'].flatMap((name) => rawHeaders(raw, name));
  return { envelope: { from, to }, raw: raw.replace(/(^|\r?\n)Bcc:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*(?=\r?\n|$)/gi, '$1') };
}
export function iCloudThreadId(input: { messageId?: string; inReplyTo?: string; references?: string | string[] }, locator: string) {
  const messageIds = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join(' ') : value ?? '').match(/<[^>]+>/g) ?? [];
  const rootMessageId = messageIds(input.references)[0] ?? messageIds(input.inReplyTo)[0] ?? messageIds(input.messageId)[0] ?? `locator:${locator}`;
  return `icloud:${Buffer.from(rootMessageId.toLowerCase()).toString('base64url')}`;
}
function iCloudThreadRoot(threadId: string) {
  if (!threadId.startsWith('icloud:')) throw new ICloudApiError('Invalid iCloud thread identifier');
  return Buffer.from(threadId.slice('icloud:'.length), 'base64url').toString('utf8');
}

export class ICloudApiError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number, readonly smtp?: { responseCode?: number; code?: string; command?: string; deliveryUncertain: boolean }) { super(message); }
}
export function isRetryableICloudError(error: unknown) { return error instanceof ICloudApiError && error.retryable; }

type SmtpError = { responseCode?: unknown; code?: unknown; command?: unknown; message?: unknown };
export function classifyICloudSmtpError(error: unknown) {
  const smtp = error && typeof error === 'object' ? error as SmtpError : {};
  const responseCode = typeof smtp.responseCode === 'number' ? smtp.responseCode : undefined;
  const code = typeof smtp.code === 'string' ? smtp.code : undefined;
  const command = typeof smtp.command === 'string' ? smtp.command : undefined;
  const message = typeof smtp.message === 'string' ? smtp.message : 'iCloud SMTP request failed';
  const deliveryUncertain = command?.toUpperCase() === 'DATA';
  if ((responseCode !== undefined && responseCode >= 500) || code === 'EAUTH') {
    const status = responseCode === 535 || code === 'EAUTH' ? 401 : 422;
    return new ICloudApiError(message, false, status, { responseCode, code, command, deliveryUncertain: false });
  }
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
    return new ICloudApiError(message, true, 503, { responseCode, code, command, deliveryUncertain: false });
  }
  return new ICloudApiError(message, true, undefined, { responseCode, code, command, deliveryUncertain });
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!);
    }
  }));
  return results;
}

function requireImapSuccess(result: boolean, operation: string) {
  if (!result) throw new ICloudApiError(`iCloud ${operation} did not complete`, false, 502);
}

function imapOptions(credentials: ICloudEmailConnectorCredentials) {
  return {
    host: 'imap.mail.me.com', port: 993, secure: true, auth: { user: credentials.username, pass: credentials.appPassword },
    logger: false as const, disableAutoIdle: true, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    maxLiteralSize: 25 * 1024 * 1024, maxResponseSize: 30 * 1024 * 1024,
  };
}

async function withImap<T>(credentials: ICloudEmailConnectorCredentials, operation: (client: ImapFlow) => Promise<T>) {
  const client = new ImapFlow(imapOptions(credentials));
  try { await client.connect(); return await operation(client); }
  catch (error) {
    if (error instanceof ICloudApiError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    throw new ICloudApiError(error instanceof Error ? error.message : 'iCloud Mail request failed', ['CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code));
  } finally { if (client.usable) await client.logout().catch(() => client.close()); else client.close(); }
}

async function resourceFromFetch(item: FetchMessageObject, mailbox: string, validity: bigint, ownEmail: string, role: MailboxRole): Promise<GmailMessageResource> {
  if (!item.source) throw new ICloudApiError('iCloud message source is unavailable');
  const parsed = await simpleParser(item.source, { skipHtmlToText: true, skipTextToHtml: true, maxHtmlLengthToParse: 5 * 1024 * 1024 });
  const locator = encodedLocator({ mailbox, validity: validity.toString(), uid: item.uid });
  const threadId = iCloudThreadId({ messageId: parsed.messageId, inReplyTo: parsed.inReplyTo, references: parsed.references }, locator);
  const headers = [
    { name: 'From', value: addressList(parsed.from) },
    { name: 'To', value: addressList(parsed.to && !Array.isArray(parsed.to) ? parsed.to : undefined) },
    { name: 'Cc', value: addressList(parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc : undefined) },
    { name: 'Bcc', value: addressList(parsed.bcc && !Array.isArray(parsed.bcc) ? parsed.bcc : undefined) },
    { name: 'Reply-To', value: addressList(parsed.replyTo) },
    { name: 'Subject', value: parsed.subject ?? '(No subject)' },
    { name: 'Message-ID', value: parsed.messageId ?? '' },
    { name: 'In-Reply-To', value: parsed.inReplyTo ?? '' },
    { name: 'References', value: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references ?? '' },
  ].filter(({ value }) => value);
  const flags = item.flags ?? new Set<string>();
  const labels = [role === 'inbox' ? 'INBOX' : '', flags.has('\\Seen') ? '' : 'UNREAD', flags.has('\\Flagged') ? 'STARRED' : '', role === 'sent' ? 'SENT' : '', role === 'trash' ? 'TRASH' : ''].filter(Boolean);
  const html = typeof parsed.html === 'string' ? parsed.html : undefined;
  const text = parsed.text ?? parsed.textAsHtml ?? '';
  return {
    id: locator, threadId, labelIds: labels, snippet: (parsed.text ?? '').replace(/\s+/g, ' ').slice(0, 400),
    internalDate: String(new Date(item.internalDate ?? parsed.date ?? Date.now()).getTime()),
    payload: {
      mimeType: html ? 'multipart/alternative' : 'text/plain', headers,
      ...(html ? { parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } }, { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }, ...(parsed.attachments.length ? [{ filename: parsed.attachments[0]?.filename ?? 'attachment' }] : [])] } : { body: { data: Buffer.from(text).toString('base64url') }, ...(parsed.attachments.length ? { parts: [{ filename: parsed.attachments[0]?.filename ?? 'attachment' }] } : {}) }),
    },
  };
}

type LightweightMessage = Pick<GmailMessageResource, 'id' | 'threadId' | 'labelIds' | 'internalDate'>;
function labelsFromFlags(flags: Set<string> | undefined, role: MailboxRole) {
  return [role === 'inbox' ? 'INBOX' : '', flags?.has('\\Seen') ? '' : 'UNREAD', flags?.has('\\Flagged') ? 'STARRED' : '', role === 'sent' ? 'SENT' : '', role === 'trash' ? 'TRASH' : ''].filter(Boolean);
}
function lightweightFromFetch(item: FetchMessageObject, mailbox: string, validity: bigint, role: MailboxRole): LightweightMessage {
  const locator = encodedLocator({ mailbox, validity: validity.toString(), uid: item.uid });
  const references = item.headers ? rawHeaders(item.headers.toString('utf8'), 'References').join(' ') : undefined;
  return {
    id: locator,
    threadId: iCloudThreadId({ messageId: item.envelope?.messageId, inReplyTo: item.envelope?.inReplyTo, references }, locator),
    labelIds: labelsFromFlags(item.flags, role),
    internalDate: String(new Date(item.internalDate ?? item.envelope?.date ?? Date.now()).getTime()),
  };
}

export async function verifyICloudCredentials(credentials: ICloudEmailConnectorCredentials) {
  await withImap(credentials, async (client) => { await client.mailboxOpen('INBOX', { readOnly: true }); });
  return { providerAccountId: createHash('sha256').update(credentials.username.toLowerCase()).digest('hex'), email: credentials.username.toLowerCase() };
}

export function createICloudClient(credentials: ICloudEmailConnectorCredentials, runImap: typeof withImap = withImap, createTransport: typeof nodemailer.createTransport = nodemailer.createTransport) {
  const hydratedMessagesById = new Map<string, GmailMessageResource>();
  const hydrationById = new Map<string, Promise<GmailMessageResource>>();
  const indexedMessagesById = new Map<string, LightweightMessage>();
  const messagesByThread = new Map<string, LightweightMessage[]>();
  let mailboxIndexComplete = false;
  const cacheHydrated = (resources: GmailMessageResource[]) => {
    for (const resource of resources) hydratedMessagesById.set(resource.id, resource);
    return resources;
  };
  const cacheIndexed = (resources: LightweightMessage[]) => {
    for (const resource of resources) {
      indexedMessagesById.set(resource.id, resource);
      const thread = messagesByThread.get(resource.threadId) ?? [];
      if (!thread.some(({ id }) => id === resource.id)) thread.push(resource);
      messagesByThread.set(resource.threadId, thread);
    }
    return resources;
  };
  const fetchLocator = (locator: Locator) => runImap(credentials, async (client) => {
    const mailboxes = await client.list();
    const mailbox = await client.mailboxOpen(locator.mailbox, { readOnly: true });
    if (mailbox.uidValidity !== BigInt(locator.validity)) throw new ICloudApiError('iCloud mailbox identity changed; synchronize the inbox again');
    const item = await client.fetchOne(String(locator.uid), { uid: true, flags: true, internalDate: true, source: { maxLength: 25 * 1024 * 1024 } }, { uid: true });
    if (!item) throw new ICloudApiError('iCloud message was not found', false, 404);
    const resource = await resourceFromFetch(item, locator.mailbox, mailbox.uidValidity, credentials.username, iCloudMailboxRole(mailboxes, locator.mailbox));
    cacheHydrated([resource]);
    return resource;
  });
  const fetchResources = async (client: ImapFlow, uids: number[], mailboxPath: string, validity: bigint, role: MailboxRole) => {
    const resources: GmailMessageResource[] = [];
    for (let offset = 0; offset < uids.length; offset += 50) {
      const fetched = await client.fetchAll(uids.slice(offset, offset + 50), { uid: true, flags: true, internalDate: true, source: { maxLength: 25 * 1024 * 1024 } }, { uid: true });
      resources.push(...await mapConcurrent(fetched, 8, (item) => resourceFromFetch(item, mailboxPath, validity, credentials.username, role)));
    }
    return resources;
  };
  const fetchLightweightResources = async (client: ImapFlow, uids: number[], mailboxPath: string, validity: bigint, role: MailboxRole) => {
    const resources: LightweightMessage[] = [];
    for (let offset = 0; offset < uids.length; offset += 50) {
      const fetched = await client.fetchAll(uids.slice(offset, offset + 50), { uid: true, flags: true, internalDate: true, envelope: true, headers: ['References'] }, { uid: true });
      resources.push(...fetched.map((item) => lightweightFromFetch(item, mailboxPath, validity, role)));
    }
    return resources;
  };
  const listMailbox = (mailboxPath: string, limit: number, since?: Date, role?: MailboxRole) => runImap(credentials, async (client) => {
    if (!role) role = iCloudMailboxRole(await client.list(), mailboxPath);
    const mailbox = await client.mailboxOpen(mailboxPath, { readOnly: true });
    const matches = await client.search(since ? { since } : { all: true }, { uid: true });
    if (matches === false) throw new ICloudApiError(`iCloud could not search ${mailboxPath}`, true, 503);
    const uids = matches.slice(-limit);
    if (!uids.length) return { resources: [] as GmailMessageResource[], complete: true };
    return { resources: cacheHydrated(await fetchResources(client, uids, mailboxPath, mailbox.uidValidity, role)), complete: matches.length <= limit };
  });
  const mutate = <T>(id: string, operation: (client: ImapFlow, locator: Locator, mailboxes: ListResponse[]) => Promise<T>) => runImap(credentials, async (client) => {
    const locator = decodedLocator(id);
    const mailboxes = await client.list();
    const mailbox = await client.mailboxOpen(locator.mailbox);
    if (mailbox.uidValidity !== BigInt(locator.validity)) throw new ICloudApiError('iCloud mailbox identity changed; synchronize the inbox again');
    const result = await operation(client, locator, mailboxes);
    mailboxIndexComplete = false;
    hydratedMessagesById.delete(id);
    hydrationById.delete(id);
    return result;
  });
  const findMessageByRfc822Id = async (messageId: string) => runImap(credentials, async (client) => {
    const mailboxes = await client.list();
    const sent = mailboxByUse(mailboxes, '\\Sent', 'Sent Messages');
    const mailbox = await client.mailboxOpen(sent, { readOnly: true });
    const matches = await client.search({ header: { 'Message-ID': messageId } }, { uid: true });
    const uid = matches && matches.at(-1);
    if (!uid) return null;
    const item = await client.fetchOne(String(uid), { uid: true, flags: true, internalDate: true, source: { maxLength: 25 * 1024 * 1024 } }, { uid: true });
    if (!item) return null;
    const resource = await resourceFromFetch(item, sent, mailbox.uidValidity, credentials.username, 'sent');
    cacheHydrated([resource]);
    return { id: resource.id, threadId: resource.threadId };
  });
  const buildMailboxIndex = () => runImap(credentials, async (client) => {
    const mailboxes = (await client.list()).filter(({ flags, specialUse }) => !flags.has('\\Noselect') && specialUse !== '\\Draft');
    const resources: LightweightMessage[] = [];
    for (const listed of mailboxes) {
      const mailbox = await client.mailboxOpen(listed.path, { readOnly: true });
      const matches = await client.search({ all: true }, { uid: true });
      if (matches === false) throw new ICloudApiError(`iCloud could not search ${listed.path}`, true, 503);
      resources.push(...await fetchLightweightResources(client, matches, listed.path, mailbox.uidValidity, iCloudMailboxRole(mailboxes, listed.path)));
    }
    const previousIndex = new Map(indexedMessagesById);
    indexedMessagesById.clear();
    messagesByThread.clear();
    cacheIndexed(resources);
    for (const resource of resources) {
      const previous = previousIndex.get(resource.id);
      if (previous && (previous.threadId !== resource.threadId || previous.internalDate !== resource.internalDate || previous.labelIds?.join('\0') !== resource.labelIds?.join('\0'))) {
        hydratedMessagesById.delete(resource.id);
        hydrationById.delete(resource.id);
      }
    }
    for (const id of hydratedMessagesById.keys()) if (!indexedMessagesById.has(id)) hydratedMessagesById.delete(id);
    mailboxIndexComplete = true;
    return resources;
  });
  const ensureMailboxIndex = async () => mailboxIndexComplete ? [...indexedMessagesById.values()] : buildMailboxIndex();
  const threadResources = async (threadId: string) => {
    const root = iCloudThreadRoot(threadId);
    if (root.startsWith('locator:')) return [await fetchLocator(decodedLocator(root.slice('locator:'.length)))];
    await ensureMailboxIndex();
    return messagesByThread.get(threadId) ?? [];
  };
  return {
    async profile() { return { emailAddress: credentials.username, messagesTotal: 0, threadsTotal: 0, historyId: new Date().toISOString() }; },
    async listThreads(_maxResults = 100) {
      const resources = await ensureMailboxIndex();
      return { threads: [...new Set(resources.map(({ threadId }) => threadId))].map((id) => ({ id })) };
    },
    async history(startHistoryId: string) {
      const listed = await listMailbox('INBOX', 10_000, new Date(startHistoryId));
      return { history: listed.resources.map((message) => ({ id: message.id, messagesAdded: [{ message: { id: message.id, threadId: message.threadId } }] })), historyId: new Date().toISOString() };
    },
    async threadMetadata(id: string): Promise<GmailThreadResource> {
      const messages = await threadResources(id);
      if (!messages.length) throw new ICloudApiError('iCloud thread was not found', false, 404);
      return { id, messages: messages.map((message) => ({ id: message.id, threadId: id, labelIds: message.labelIds, internalDate: message.internalDate })) };
    },
    message(id: string) {
      const hydrated = hydratedMessagesById.get(id);
      if (hydrated) return hydrated;
      const pending = hydrationById.get(id);
      if (pending) return pending;
      const hydration = fetchLocator(decodedLocator(id)).finally(() => hydrationById.delete(id));
      hydrationById.set(id, hydration);
      return hydration;
    },
    findMessageByRfc822Id,
    async modifyThread(id: string, addLabelIds: string[], removeLabelIds: string[]) {
      for (const message of await threadResources(id)) await mutate(message.id, async (client, locator) => {
        if (addLabelIds.includes('UNREAD')) requireImapSuccess(await client.messageFlagsRemove([locator.uid], ['\\Seen'], { uid: true }), 'mark-unread operation');
        if (removeLabelIds.includes('UNREAD')) requireImapSuccess(await client.messageFlagsAdd([locator.uid], ['\\Seen'], { uid: true }), 'mark-read operation');
        if (addLabelIds.includes('STARRED')) requireImapSuccess(await client.messageFlagsAdd([locator.uid], ['\\Flagged'], { uid: true }), 'star operation');
        if (removeLabelIds.includes('STARRED')) requireImapSuccess(await client.messageFlagsRemove([locator.uid], ['\\Flagged'], { uid: true }), 'unstar operation');
      });
    },
    async trashThread(id: string) {
      const moved: Array<{ id: string; threadId: string }> = [];
      for (const message of await threadResources(id)) if (!message.labelIds?.includes('TRASH')) {
        const result = await mutate(message.id, async (client, locator, mailboxes) => {
          if (client.capabilities instanceof Map && !client.capabilities.has('MOVE')) throw new ICloudApiError('iCloud server does not support safe message moves', false, 501);
          const move = await client.messageMove([locator.uid], mailboxByUse(mailboxes, '\\Trash', 'Deleted Messages'), { uid: true });
          if (!move) throw new ICloudApiError('iCloud move operation did not complete', false, 502);
          return { move, sourceUid: locator.uid };
        });
        const destinationUid = result.move.uidMap?.get(result.sourceUid);
        if (destinationUid && result.move.uidValidity) moved.push({ id: encodedLocator({ mailbox: result.move.destination, validity: result.move.uidValidity.toString(), uid: destinationUid }), threadId: id });
      }
      return { id, messages: moved };
    },
    async listTrashMessages(maxResults = 500, pageToken?: string) {
      return runImap(credentials, async (client) => {
        const mailboxes = await client.list();
        const trash = mailboxByUse(mailboxes, '\\Trash', 'Deleted Messages');
        const mailbox = await client.mailboxOpen(trash, { readOnly: true });
        const matches = await client.search({ all: true }, { uid: true });
        if (matches === false) throw new ICloudApiError('iCloud could not search Trash', true, 503);
        const afterUid = pageToken ? z.coerce.number().int().nonnegative().parse(pageToken) : 0;
        const remaining = [...new Set(matches)].filter((uid) => uid > afterUid).sort((left, right) => left - right);
        const uids = remaining.slice(0, Math.max(1, Math.trunc(maxResults)));
        const resources = await fetchResources(client, uids, trash, mailbox.uidValidity, 'trash');
        return { messages: resources.map(({ id, threadId }) => ({ id, threadId })), ...(remaining.length > uids.length ? { nextPageToken: String(uids.at(-1)) } : {}) };
      });
    },
    async batchDeleteMessages(ids: string[]) {
      for (const id of ids) {
        try { await mutate(id, async (client, locator) => {
          if (client.capabilities instanceof Map && !client.capabilities.has('UIDPLUS')) throw new ICloudApiError('iCloud server does not support safe UID-scoped permanent deletion', false, 501);
          requireImapSuccess(await client.messageFlagsAdd([locator.uid], ['\\Deleted'], { uid: true }), 'permanent-delete flag operation');
          requireImapSuccess(await client.messageDelete([locator.uid], { uid: true }), 'permanent-delete operation');
        }); }
        catch (error) { if (!(error instanceof ICloudApiError) || error.status !== 404) throw error; }
      }
    },
    async sendRaw(raw: string) {
      const messageId = /(?:^|\r?\n)Message-ID:\s*(<[^\r\n]+>)/i.exec(raw)?.[1];
      if (!messageId) throw new ICloudApiError('Outgoing message ID is required');
      const transporter = createTransport({ host: 'smtp.mail.me.com', port: 587, secure: false, requireTLS: true, auth: { user: credentials.username, pass: credentials.appPassword }, connectionTimeout: 20_000, socketTimeout: 30_000 });
      try { await transporter.sendMail(iCloudSmtpPayload(raw, credentials.username)); }
      catch (error) { throw classifyICloudSmtpError(error); }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const found = await findMessageByRfc822Id(messageId);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      throw new ICloudApiError('iCloud accepted the email but its sent message is not available yet', true);
    },
    async watch() { throw new ICloudApiError('iCloud Mail uses polling instead of push subscriptions'); },
    async stop() {},
    async revoke() {},
  };
}

export type ICloudClient = ReturnType<typeof createICloudClient>;
