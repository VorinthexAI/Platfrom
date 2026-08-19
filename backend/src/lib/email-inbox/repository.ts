import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { EMAIL_ACCOUNTS_COLLECTION, emailAccountSchema, type EmailAccount } from '@/lib/db/email-accounts.node';
import { EMAIL_THREADS_COLLECTION, emailThreadSchema, type EmailThread } from '@/lib/db/email-threads.node';
import { EMAIL_MESSAGES_COLLECTION, emailMessageSchema, type EmailMessage } from '@/lib/db/email-messages.node';
import { EMAIL_REPLY_DRAFTS_COLLECTION, emailReplyDraftSchema, type EmailReplyDraft } from '@/lib/db/email-reply-drafts.node';
import { EMAIL_WRITING_PROFILES_COLLECTION, emailWritingProfileSchema } from '@/lib/db/email-writing-profiles.node';
import { z } from 'zod';

type Database = Pick<typeof db, 'query' | 'collection'>;
const parse = <T>(schema: { parse: (value: unknown) => T }, raw: unknown) => schema.parse(withArangoKey(raw as Record<string, unknown>));
const emailCursorSchema = z.object({ v: z.literal(1), threadKey: z.string().cuid(), sentAt: z.string().datetime(), key: z.string().cuid() }).strict();
export function encodeEmailCursor(value: z.infer<typeof emailCursorSchema>) { return Buffer.from(JSON.stringify(emailCursorSchema.parse(value))).toString('base64url'); }
export function decodeEmailCursor(value: string, threadKey: string) {
  const parsed = emailCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (parsed.threadKey !== threadKey) throw new EmailRepositoryError('conflict', 'Email cursor belongs to another thread');
  return parsed;
}

export class EmailRepositoryError extends Error {
  constructor(readonly reason: 'not_found' | 'forbidden' | 'conflict', message: string = reason) { super(message); }
}

export function createEmailRepository(database: Database = db) {
  const queryOne = async <T>(query: string, bindVars: Record<string, unknown>, schema: { parse: (value: unknown) => T }) => {
    const cursor = await database.query(query, bindVars);
    const raw = await cursor.next();
    return raw ? parse(schema, raw) : null;
  };

  return {
    async accountForScope(scopeKey: string) {
      return queryOne<EmailAccount>('FOR account IN emailAccounts FILTER account.scopeKey == @scopeKey && account.syncEnabled == true SORT account.updatedAt DESC LIMIT 1 RETURN account', { scopeKey }, emailAccountSchema);
    },
    async listSyncTargetsByEmail(email: string) {
      const cursor = await database.query(`FOR account IN emailAccounts
        FILTER account.syncEnabled == true && LOWER(account.email) == @email
        LET connector = DOCUMENT(organizationConnectors, account.connectorKey)
        FILTER connector != null && connector.status != "revoked" && connector.scopeKey == account.scopeKey
        RETURN { organizationKey: connector.organizationKey, scopeKey: account.scopeKey }`, { email: email.toLowerCase() });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string }>>;
    },
    async listWatchRenewalTargets(before: string) {
      const cursor = await database.query(`FOR account IN emailAccounts
        FILTER account.syncEnabled == true && (account.watchExpiresAt == null || account.watchExpiresAt <= @before)
        LET connector = DOCUMENT(organizationConnectors, account.connectorKey)
        FILTER connector != null && connector.status != "revoked" && connector.scopeKey == account.scopeKey
        RETURN { organizationKey: connector.organizationKey, scopeKey: account.scopeKey }`, { before });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string }>>;
    },
    async claimSync(accountKey: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR account IN emailAccounts FILTER account._key == @accountKey && account.syncEnabled == true && (account.syncLeaseExpiresAt == null || account.syncLeaseExpiresAt <= @now) UPDATE account WITH { syncLeaseToken: @token, syncLeaseExpiresAt: @expiresAt } IN emailAccounts RETURN true', { accountKey, token, expiresAt, now: new Date().toISOString() });
      return (await cursor.next()) === true;
    },
    async releaseSync(accountKey: string, token: string) {
      await database.query('FOR account IN emailAccounts FILTER account._key == @accountKey && account.syncLeaseToken == @token UPDATE account WITH { syncLeaseToken: null, syncLeaseExpiresAt: null } IN emailAccounts OPTIONS { keepNull: false }', { accountKey, token });
    },
    async renewSync(accountKey: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR account IN emailAccounts FILTER account._key == @accountKey && account.syncLeaseToken == @token UPDATE account WITH { syncLeaseExpiresAt: @expiresAt } IN emailAccounts RETURN true', { accountKey, token, expiresAt });
      return (await cursor.next()) === true;
    },
    async updateWatch(accountKey: string, input: { historyId: string; expiration: string }) {
      const timestamp = new Date().toISOString();
      await database.collection(EMAIL_ACCOUNTS_COLLECTION).update(accountKey, { watchRegisteredAt: timestamp, watchExpiresAt: new Date(Number(input.expiration)).toISOString(), updatedAt: timestamp });
    },
    async upsertAccount(input: { scopeKey: string; connectorKey: string; providerAccountId: string; email: string; historyId?: string }) {
      const timestamp = new Date().toISOString();
      const document = emailAccountSchema.parse({ key: newId(), ...input, provider: 'gmail', syncEnabled: true, syncStatus: 'idle', createdAt: timestamp, updatedAt: timestamp });
      const cursor = await database.query(`
        UPSERT { scopeKey: @scopeKey, provider: "gmail", providerAccountId: @providerAccountId }
        INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt, historyId: @historyId != null ? @historyId : OLD.historyId })
        IN emailAccounts OPTIONS { keepNull: false } RETURN NEW
      `, { scopeKey: input.scopeKey, providerAccountId: input.providerAccountId, historyId: input.historyId ?? null, document: toArangoDoc(document) });
      return parse(emailAccountSchema, await cursor.next());
    },
    async setSyncState(accountKey: string, status: 'idle' | 'syncing' | 'error', input: { historyId?: string; error?: string } = {}) {
      const timestamp = new Date().toISOString();
      const patch = { syncStatus: status, syncError: input.error?.slice(0, 500) ?? null, historyId: input.historyId, ...(status === 'idle' ? { lastSyncedAt: timestamp } : {}), updatedAt: timestamp };
      await database.collection(EMAIL_ACCOUNTS_COLLECTION).update(accountKey, patch, { keepNull: false });
    },
    async disableAccount(accountKey: string) {
      await database.collection(EMAIL_ACCOUNTS_COLLECTION).update(accountKey, { syncEnabled: false, syncStatus: 'idle', updatedAt: new Date().toISOString() });
    },
    async disableAccounts(scopeKey: string) {
      await database.query('FOR account IN emailAccounts FILTER account.scopeKey == @scopeKey && account.syncEnabled == true UPDATE account WITH { syncEnabled: false, syncStatus: "idle", updatedAt: @updatedAt } IN emailAccounts', { scopeKey, updatedAt: new Date().toISOString() });
    },
    async syncThread(input: {
      thread: Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt'>;
      messages: Array<Omit<EmailMessage, 'key' | 'threadKey' | 'createdAt' | 'updatedAt'>>;
      reconcileMessages?: boolean;
    }) {
      const timestamp = new Date().toISOString();
      return withTransaction({ read: [], write: [EMAIL_THREADS_COLLECTION, EMAIL_MESSAGES_COLLECTION] }, async (trx) => {
        const threadDocument = emailThreadSchema.parse({ key: newId(), ...input.thread, createdAt: timestamp, updatedAt: timestamp });
        const threadCursor = await trx.query(`
          UPSERT { scopeKey: @scopeKey, accountKey: @accountKey, providerThreadId: @providerThreadId }
          INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt, isFavorite: OLD.isFavorite == true })
          IN emailThreads RETURN NEW
        `, { scopeKey: input.thread.scopeKey, accountKey: input.thread.accountKey, providerThreadId: input.thread.providerThreadId, document: toArangoDoc(threadDocument) });
        const thread = parse(emailThreadSchema, await threadCursor.next());
        for (const messageInput of input.messages) {
          const message = emailMessageSchema.parse({ key: newId(), ...messageInput, threadKey: thread.key, createdAt: timestamp, updatedAt: timestamp });
          await trx.query(`
            UPSERT { scopeKey: @scopeKey, accountKey: @accountKey, providerMessageId: @providerMessageId }
            INSERT @document UPDATE MERGE(@document, { _key: OLD._key, threadKey: @threadKey, createdAt: OLD.createdAt })
            IN emailMessages
          `, { scopeKey: message.scopeKey, accountKey: message.accountKey, providerMessageId: message.providerMessageId, threadKey: thread.key, document: toArangoDoc(message) });
        }
        if (input.reconcileMessages !== false) {
          await trx.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey && message.providerMessageId NOT IN @providerMessageIds REMOVE message IN emailMessages', {
            scopeKey: input.thread.scopeKey, threadKey: thread.key, providerMessageIds: input.messages.map(({ providerMessageId }) => providerMessageId),
          });
        }
        return thread;
      });
    },
    async overview(scopeKey: string, filter: 'all' | 'important' | 'urgent' | 'needs_action' | 'filtered' | 'unread' | 'favorite' = 'all', search?: string) {
      const account = await this.accountForScope(scopeKey);
      if (!account) return { account: null, threads: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0 } };
      const normalizedSearch = search?.trim().toLowerCase() ?? '';
      const cursor = await database.query(`
        LET scoped = (FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread.accountKey == @accountKey && thread.inInbox != false RETURN thread)
        LET visible = (FOR thread IN scoped
          FILTER @filter == "all" || (@filter == "important" && thread.priority IN ["high", "urgent"]) || (@filter == "urgent" && thread.priority == "urgent") || (@filter == "needs_action" && thread.state == "needs_action") || (@filter == "filtered" && thread.state == "filtered") || (@filter == "unread" && thread.unread == true) || (@filter == "favorite" && thread.isFavorite == true)
          FILTER @search == "" || CONTAINS(LOWER(thread.subject), @search) || CONTAINS(LOWER(thread.summary), @search) || CONTAINS(LOWER(thread.snippet || ""), @search)
          SORT thread.lastMessageAt DESC, thread._key DESC LIMIT 100 RETURN thread)
        RETURN { threads: visible, counts: {
          all: LENGTH(scoped), important: LENGTH(FOR thread IN scoped FILTER thread.priority IN ["high", "urgent"] RETURN 1), urgent: LENGTH(FOR thread IN scoped FILTER thread.priority == "urgent" RETURN 1),
          needsAction: LENGTH(FOR thread IN scoped FILTER thread.state == "needs_action" RETURN 1),
          filtered: LENGTH(FOR thread IN scoped FILTER thread.state == "filtered" RETURN 1),
          unread: LENGTH(FOR thread IN scoped FILTER thread.unread == true RETURN 1), favorite: LENGTH(FOR thread IN scoped FILTER thread.isFavorite == true RETURN 1)
        }}
      `, { scopeKey, accountKey: account.key, filter, search: normalizedSearch });
      const result = await cursor.next() as { threads: unknown[]; counts: { all: number; important: number; urgent: number; needsAction: number; filtered: number; unread: number; favorite: number } };
      return { account, threads: result.threads.map((raw) => parse(emailThreadSchema, raw)), counts: result.counts };
    },
    async thread(scopeKey: string, threadKey: string) {
      const thread = await queryOne<EmailThread>('FOR thread IN emailThreads FILTER thread._key == @threadKey && thread.scopeKey == @scopeKey && thread.inInbox != false LIMIT 1 RETURN thread', { scopeKey, threadKey }, emailThreadSchema);
      if (!thread) throw new EmailRepositoryError('not_found');
      const cursor = await database.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey SORT message.sentAt ASC, message._key ASC RETURN message', { scopeKey, threadKey });
      return { thread, messages: (await cursor.all()).map((raw) => parse(emailMessageSchema, raw)) };
    },
    async readThreadPage(scopeKey: string, threadKey: string, limit: number, cursorValue?: string) {
      const thread = await queryOne<EmailThread>('FOR thread IN emailThreads FILTER thread._key == @threadKey && thread.scopeKey == @scopeKey LIMIT 1 RETURN thread', { scopeKey, threadKey }, emailThreadSchema);
      if (!thread) throw new EmailRepositoryError('not_found');
      const after = cursorValue ? decodeEmailCursor(cursorValue, threadKey) : null;
      const cursor = await database.query(`FOR message IN emailMessages
        FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey
        FILTER @afterSentAt == null || message.sentAt > @afterSentAt || (message.sentAt == @afterSentAt && message._key > @afterKey)
        SORT message.sentAt ASC, message._key ASC LIMIT @limit RETURN message`, {
        scopeKey, threadKey, afterSentAt: after?.sentAt ?? null, afterKey: after?.key ?? null, limit: limit + 1,
      });
      const messages = (await cursor.all()).map((raw) => parse(emailMessageSchema, raw));
      const page = messages.slice(0, limit);
      const last = page.at(-1);
      return { thread, messages: page, nextCursor: messages.length > limit && last ? encodeEmailCursor({ v: 1, threadKey, sentAt: last.sentAt, key: last.key }) : null };
    },
    async markThreadRead(scopeKey: string, threadKey: string) {
      const thread = await this.thread(scopeKey, threadKey);
      await database.collection(EMAIL_THREADS_COLLECTION).update(threadKey, { unread: false, updatedAt: new Date().toISOString() });
      return thread.thread;
    },
    async setThreadFavorite(scopeKey: string, threadKey: string, isFavorite: boolean) {
      const cursor = await database.query('FOR thread IN emailThreads FILTER thread._key == @threadKey && thread.scopeKey == @scopeKey && thread.inInbox != false UPDATE thread WITH { isFavorite: @isFavorite, updatedAt: @updatedAt } IN emailThreads RETURN NEW', { scopeKey, threadKey, isFavorite, updatedAt: new Date().toISOString() });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('not_found');
      return parse(emailThreadSchema, raw);
    },
    async deleteProviderThread(scopeKey: string, accountKey: string, providerThreadId: string) {
      const thread = await queryOne<EmailThread>('FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread.accountKey == @accountKey && thread.providerThreadId == @providerThreadId LIMIT 1 RETURN thread', { scopeKey, accountKey, providerThreadId }, emailThreadSchema);
      if (!thread) return;
      await withTransaction([EMAIL_MESSAGES_COLLECTION, EMAIL_THREADS_COLLECTION], async (trx) => {
        await trx.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey REMOVE message IN emailMessages', { scopeKey, threadKey: thread.key });
        await trx.query('FOR thread IN emailThreads FILTER thread._key == @threadKey && thread.scopeKey == @scopeKey REMOVE thread IN emailThreads', { scopeKey, threadKey: thread.key });
      });
    },
    async reconcileInbox(scopeKey: string, accountKey: string, providerThreadIds: string[]) {
      await database.query('FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread.accountKey == @accountKey && thread.inInbox != false && thread.providerThreadId NOT IN @providerThreadIds UPDATE thread WITH { inInbox: false, updatedAt: @updatedAt } IN emailThreads', { scopeKey, accountKey, providerThreadIds, updatedAt: new Date().toISOString() });
    },
    async reconcileThreadMessages(scopeKey: string, threadKey: string, providerMessageIds: string[]) {
      await database.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey && message.providerMessageId NOT IN @providerMessageIds REMOVE message IN emailMessages', { scopeKey, threadKey, providerMessageIds });
    },
    async writingProfile(scopeKey: string, profileKey?: string) {
      return queryOne(`FOR profile IN emailWritingProfiles FILTER profile.scopeKey == @scopeKey FILTER @profileKey == null || profile._key == @profileKey SORT profile.updatedAt DESC LIMIT 1 RETURN profile`, { scopeKey, profileKey: profileKey ?? null }, emailWritingProfileSchema);
    },
    async createDraft(input: Omit<EmailReplyDraft, 'key' | 'createdAt' | 'updatedAt'>) {
      const timestamp = new Date().toISOString();
      const draft = emailReplyDraftSchema.parse({ key: newId(), ...input, createdAt: timestamp, updatedAt: timestamp });
      const result = await database.collection(EMAIL_REPLY_DRAFTS_COLLECTION).save(toArangoDoc(draft), { returnNew: true });
      return parse(emailReplyDraftSchema, (result as { new: unknown }).new);
    },
    async updateDraft(scopeKey: string, draftKey: string, finalContent: string) {
      const cursor = await database.query('FOR draft IN emailReplyDrafts FILTER draft._key == @draftKey && draft.scopeKey == @scopeKey && draft.status IN ["generated", "edited"] UPDATE draft WITH { finalContent: @finalContent, status: "edited", updatedAt: @updatedAt } IN emailReplyDrafts RETURN NEW', { scopeKey, draftKey, finalContent, updatedAt: new Date().toISOString() });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft is already sending or finalized');
      return parse(emailReplyDraftSchema, raw);
    },
    async claimDraft(scopeKey: string, draftKey: string) {
      const updatedAt = new Date().toISOString();
      const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
      const cursor = await database.query(`FOR draft IN emailReplyDrafts FILTER draft._key == @draftKey && draft.scopeKey == @scopeKey && (draft.status IN ["generated", "edited"] || (draft.status == "sending" && (draft.sendStartedAt == null || draft.sendStartedAt < @staleBefore))) UPDATE draft WITH { status: "sending", sendStartedAt: @updatedAt, updatedAt: @updatedAt } IN emailReplyDrafts RETURN NEW`, { scopeKey, draftKey, staleBefore, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft was already sent or is being sent');
      return parse(emailReplyDraftSchema, raw);
    },
    async finishDraft(draftKey: string, sent: boolean, providerMessageId?: string) {
      const result = await database.collection(EMAIL_REPLY_DRAFTS_COLLECTION).update(draftKey, { status: sent ? 'sent' : 'edited', providerMessageId, sendStartedAt: null, updatedAt: new Date().toISOString() }, { returnNew: true, keepNull: false });
      return parse(emailReplyDraftSchema, (result as { new: unknown }).new);
    },
  };
}

export type EmailRepository = ReturnType<typeof createEmailRepository>;
