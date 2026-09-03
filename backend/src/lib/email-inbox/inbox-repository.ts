import { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { EMAIL_INBOXES_COLLECTION, emailInboxSchema, type EmailInbox } from '@/lib/db/email-inboxes.node';
import type { OrganizationConnector } from './connector-schema';
import { emailInboxKey } from './inbox-key';
import type { EmailCreatedAtRange } from './repository';

type Database = Pick<typeof db, 'query'>;
const parse = (value: unknown) => emailInboxSchema.parse(withArangoKey(value as Record<string, unknown>));
const revision = (value: unknown) => z.string().min(1).parse((value as Record<string, unknown>)._rev);

export function createInboxRepository(database: Database = db) {
  return {
    async getByConnector(organizationKey: string, scopeKey: string, connectorKey: string): Promise<(EmailInbox & { revision: string }) | null> {
      const cursor = await database.query(`LET connector = DOCUMENT(organizationConnectors, @connectorKey) FILTER connector != null && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked" LET inbox = DOCUMENT(@@inboxes, @inboxKey) FILTER inbox != null && inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey == connector._key RETURN inbox`, { '@inboxes': EMAIL_INBOXES_COLLECTION, organizationKey, scopeKey, connectorKey, inboxKey: emailInboxKey(scopeKey, connectorKey) });
      const value = await cursor.next();
      return value ? { ...parse(value), revision: revision(value) } : null;
    },
    async search(organizationKey: string, scopeKey: string, connectorKeys: string[], embedding: number[], query: string, minimumScore: number, limit: number, range: EmailCreatedAtRange = {}) {
      if (!connectorKeys.length) return [];
      const normalized = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR inbox IN @@inboxes FILTER inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey IN @connectorKeys FILTER @createdFrom == null || inbox.createdAt >= @createdFrom FILTER @createdTo == null || inbox.createdAt <= @createdTo LET connector = DOCUMENT(organizationConnectors, inbox.connectorKey) FILTER connector != null && connector.provider == "gmail" && connector.status != "revoked" FILTER IS_ARRAY(inbox.embedding) && LENGTH(inbox.embedding) == LENGTH(@embedding) LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", inbox.name, inbox.description)), @query) LET score = COSINE_SIMILARITY(inbox.embedding, @embedding) FILTER direct || IS_NUMBER(score) && score >= @minimumScore SORT direct DESC, score DESC, inbox.updatedAt DESC, inbox._key ASC LIMIT @limit RETURN { inbox, score: direct ? 1 : score }`, { '@inboxes': EMAIL_INBOXES_COLLECTION, organizationKey, scopeKey, connectorKeys, embedding, query: normalized, minimumScore, limit, createdFrom: range.createdFrom ?? null, createdTo: range.createdTo ?? null });
      return (await cursor.all() as Array<{ inbox: unknown; score: number }>).map(({ inbox, score }) => ({ inbox: parse(inbox), score }));
    },
    async ensure(connector: OrganizationConnector, metadata: { name: string; description?: string }, embedding: number[], overwrite: boolean, expectedRevision?: string | null): Promise<(EmailInbox & { revision: string }) | null> {
      const timestamp = new Date().toISOString();
      const key = emailInboxKey(connector.scopeKey, connector.key);
      const value = emailInboxSchema.parse({ key, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, connectorKey: connector.key, name: metadata.name, ...(metadata.description ? { description: metadata.description } : {}), isFavorite: false, embedding, createdAt: timestamp, updatedAt: timestamp });
      try {
        const cursor = await database.query(`LET connector = DOCUMENT(organizationConnectors, @connectorKey) FILTER connector != null && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" LET existing = DOCUMENT(@@inboxes, @key) FILTER existing == null ? @expectedRevision == null : (!@overwrite || existing._rev == @expectedRevision) UPSERT { _key: @key } INSERT @value UPDATE (@overwrite && OLD.organizationKey == @organizationKey && OLD.scopeKey == @scopeKey && OLD.connectorKey == @connectorKey ? MERGE(@value, { _key: OLD._key, createdAt: OLD.createdAt, isFavorite: OLD.isFavorite, coverImageKey: OLD.coverImageKey }) : {}) IN @@inboxes OPTIONS { keepNull: false } RETURN NEW`, { '@inboxes': EMAIL_INBOXES_COLLECTION, key, connectorKey: connector.key, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, overwrite, expectedRevision: expectedRevision ?? null, value: toArangoDoc(value) });
        const raw = await cursor.next();
        return raw ? { ...parse(raw), revision: revision(raw) } : null;
      } catch (caught) {
        if (!isArangoUniqueConstraintError(caught)) throw caught;
        const existing = await this.getByConnector(connector.organizationKey, connector.scopeKey, connector.key);
        if (!existing) throw caught;
        if (!overwrite || expectedRevision === undefined || existing.revision === expectedRevision) return existing;
        return null;
      }
    },
    async update(organizationKey: string, scopeKey: string, connectorKey: string, expectedUpdatedAt: string, patch: { name?: string; description?: string | null; coverImageKey?: string | null; isFavorite?: boolean; embedding?: number[] }): Promise<{ inbox: EmailInbox; coverStorageKey?: string } | null> {
      const cursor = await database.query(`LET connector = DOCUMENT(organizationConnectors, @connectorKey) FILTER connector != null && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked" LET inbox = DOCUMENT(@@inboxes, @key) FILTER inbox != null && inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey == connector._key && inbox.updatedAt == @expectedUpdatedAt LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey) FILTER !@setCover || @coverImageKey == null || cover != null && cover.scopeKey == @scopeKey LET patch = MERGE(@setName ? { name: @name } : {}, @setDescription ? { description: @description } : {}, @setCover ? { coverImageKey: @coverImageKey } : {}, @setFavorite ? { isFavorite: @isFavorite } : {}, @setEmbedding ? { embedding: @embedding } : {}, { updatedAt: @updatedAt }) UPDATE inbox WITH patch IN @@inboxes OPTIONS { keepNull: false } RETURN { inbox: NEW, coverStorageKey: cover.storageKey }`, { '@inboxes': EMAIL_INBOXES_COLLECTION, key: emailInboxKey(scopeKey, connectorKey), organizationKey, scopeKey, connectorKey, expectedUpdatedAt, updatedAt: new Date().toISOString(), setName: patch.name !== undefined, name: patch.name ?? null, setDescription: Object.hasOwn(patch, 'description'), description: patch.description ?? null, setCover: Object.hasOwn(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null, setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false, setEmbedding: patch.embedding !== undefined, embedding: patch.embedding ?? null });
      const row = await cursor.next() as { inbox: unknown; coverStorageKey?: string } | undefined;
      return row ? { inbox: parse(row.inbox), ...(row.coverStorageKey ? { coverStorageKey: row.coverStorageKey } : {}) } : null;
    },
    async coverStorageKey(scopeKey: string, coverImageKey?: string) { if (!coverImageKey) return undefined; const cursor = await database.query('LET image = DOCUMENT(images, @key) FILTER image != null && image.scopeKey == @scopeKey RETURN image.storageKey', { key: coverImageKey, scopeKey }); return await cursor.next() as string | undefined; },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
