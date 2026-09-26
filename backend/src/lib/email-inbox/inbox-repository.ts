import { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { EMAIL_INBOXES_COLLECTION, emailInboxSchema, type EmailInbox } from '@/lib/db/email-inboxes.node';
import type { UserConnector } from './connector-schema';
import { emailInboxKey } from './inbox-key';
import type { EmailCreatedAtRange } from './repository';

type Database = Pick<typeof db, 'query'>;
const parse = (value: unknown) => emailInboxSchema.parse(withArangoKey(value as Record<string, unknown>));
const revision = (value: unknown) => z.string().min(1).parse((value as Record<string, unknown>)._rev);

export function createInboxRepository(database: Database = db) {
  return {
    async getByConnector(userKey: string, connectorKey: string): Promise<(EmailInbox & { revision: string }) | null> {
      const cursor = await database.query(`LET connector = DOCUMENT(userConnectors, @connectorKey) FILTER connector != null && connector.userKey == @userKey && connector.provider == "gmail" && connector.status != "revoked" FOR inbox IN @@inboxes FILTER inbox.userKey == @userKey && inbox.connectorKey == connector._key LIMIT 1 RETURN inbox`, { '@inboxes': EMAIL_INBOXES_COLLECTION, userKey, connectorKey });
      const value = await cursor.next();
      return value ? { ...parse(value), revision: revision(value) } : null;
    },
    async search(userKey: string, connectorKeys: string[], embedding: number[], query: string, minimumScore: number, limit: number, range: EmailCreatedAtRange = {}) {
      if (!connectorKeys.length) return [];
      const normalized = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR inbox IN @@inboxes FILTER inbox.userKey == @userKey && inbox.connectorKey IN @connectorKeys FILTER @createdFrom == null || inbox.createdAt >= @createdFrom FILTER @createdTo == null || inbox.createdAt <= @createdTo LET connector = DOCUMENT(userConnectors, inbox.connectorKey) FILTER connector != null && connector.userKey == @userKey && connector.provider == "gmail" && connector.status != "revoked" FILTER IS_ARRAY(inbox.embedding) && LENGTH(inbox.embedding) == LENGTH(@embedding) LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", inbox.name, inbox.description)), @query) LET score = COSINE_SIMILARITY(inbox.embedding, @embedding) FILTER direct || IS_NUMBER(score) && score >= @minimumScore SORT direct DESC, score DESC, inbox.updatedAt DESC, inbox._key ASC LIMIT @limit RETURN { inbox, score: direct ? 1 : score }`, { '@inboxes': EMAIL_INBOXES_COLLECTION, userKey, connectorKeys, embedding, query: normalized, minimumScore, limit, createdFrom: range.createdFrom ?? null, createdTo: range.createdTo ?? null });
      return (await cursor.all() as Array<{ inbox: unknown; score: number }>).map(({ inbox, score }) => ({ inbox: parse(inbox), score }));
    },
    async ensure(connector: UserConnector, metadata: { name: string; description?: string }, embedding: number[], overwrite: boolean, expectedRevision?: string | null): Promise<(EmailInbox & { revision: string }) | null> {
      const timestamp = new Date().toISOString();
      const key = emailInboxKey(connector.scopeKey, connector.key);
      const value = emailInboxSchema.parse({ key, userKey: connector.userKey, teamKey: connector.teamKey, scopeKey: connector.scopeKey, connectorKey: connector.key, name: metadata.name, ...(metadata.description ? { description: metadata.description } : {}), isFavorite: false, embedding, createdAt: timestamp, updatedAt: timestamp });
      try {
        const cursor = await database.query(`LET connector = DOCUMENT(userConnectors, @connectorKey) FILTER connector != null && connector.userKey == @userKey && connector.provider == "gmail" LET existing = FIRST(FOR inbox IN @@inboxes FILTER inbox.userKey == @userKey && inbox.connectorKey == @connectorKey LIMIT 1 RETURN inbox) LET keyed = DOCUMENT(@@inboxes, @key) LET target = existing != null ? existing : (keyed != null && keyed.userKey == @userKey && keyed.connectorKey == @connectorKey ? keyed : null) FILTER target == null ? (@expectedRevision == null && keyed == null) : (!@overwrite || target._rev == @expectedRevision) LET written = target == null ? (INSERT @value IN @@inboxes OPTIONS { keepNull: false } RETURN NEW)[0] : (@overwrite ? (UPDATE target WITH MERGE(@value, { _key: target._key, createdAt: target.createdAt, isFavorite: target.isFavorite, coverImageKey: target.coverImageKey }) IN @@inboxes OPTIONS { keepNull: false } RETURN NEW)[0] : target) RETURN written`, { '@inboxes': EMAIL_INBOXES_COLLECTION, connectorKey: connector.key, userKey: connector.userKey, key, overwrite, expectedRevision: expectedRevision ?? null, value: toArangoDoc(value) });
        const raw = await cursor.next();
        return raw ? { ...parse(raw), revision: revision(raw) } : null;
      } catch (caught) {
        if (!isArangoUniqueConstraintError(caught)) throw caught;
        const existing = await this.getByConnector(connector.userKey, connector.key);
        if (!existing) throw caught;
        if (!overwrite || expectedRevision === undefined || existing.revision === expectedRevision) return existing;
        return null;
      }
    },
    async update(userKey: string, scopeKey: string, connectorKey: string, expectedUpdatedAt: string, patch: { name?: string; description?: string | null; coverImageKey?: string | null; isFavorite?: boolean; embedding?: number[] }): Promise<{ inbox: EmailInbox; coverStorageKey?: string } | null> {
      const cursor = await database.query(`LET connector = DOCUMENT(userConnectors, @connectorKey) FILTER connector != null && connector.userKey == @userKey && connector.provider == "gmail" && connector.status != "revoked" LET inbox = FIRST(FOR value IN @@inboxes FILTER value.userKey == @userKey && value.connectorKey == connector._key LIMIT 1 RETURN value) FILTER inbox != null && inbox.updatedAt == @expectedUpdatedAt LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey) FILTER !@setCover || @coverImageKey == null || cover != null && cover.scopeKey == @scopeKey LET patch = MERGE(@setName ? { name: @name } : {}, @setDescription ? { description: @description } : {}, @setCover ? { coverImageKey: @coverImageKey } : {}, @setFavorite ? { isFavorite: @isFavorite } : {}, @setEmbedding ? { embedding: @embedding } : {}, { updatedAt: @updatedAt }) UPDATE inbox WITH patch IN @@inboxes OPTIONS { keepNull: false } RETURN { inbox: NEW, coverStorageKey: cover.storageKey }`, { '@inboxes': EMAIL_INBOXES_COLLECTION, userKey, scopeKey, connectorKey, expectedUpdatedAt, updatedAt: new Date().toISOString(), setName: patch.name !== undefined, name: patch.name ?? null, setDescription: Object.hasOwn(patch, 'description'), description: patch.description ?? null, setCover: Object.hasOwn(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null, setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false, setEmbedding: patch.embedding !== undefined, embedding: patch.embedding ?? null });
      const row = await cursor.next() as { inbox: unknown; coverStorageKey?: string } | undefined;
      return row ? { inbox: parse(row.inbox), ...(row.coverStorageKey ? { coverStorageKey: row.coverStorageKey } : {}) } : null;
    },
    async coverStorageKey(scopeKey: string, coverImageKey?: string) { if (!coverImageKey) return undefined; const cursor = await database.query('LET image = DOCUMENT(images, @key) FILTER image != null && image.scopeKey == @scopeKey RETURN image.storageKey', { key: coverImageKey, scopeKey }); return await cursor.next() as string | undefined; },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
