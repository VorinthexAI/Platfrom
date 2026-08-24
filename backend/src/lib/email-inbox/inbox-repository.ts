import { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { INBOXES_COLLECTION, inboxSchema, type Inbox } from './inbox-schema';
import type { OrganizationConnector } from './connector-schema';

type Database = Pick<typeof db, 'query' | 'collection'>;

function parse(raw: unknown) {
  return inboxSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

function revision(raw: unknown) {
  const value = raw as Record<string, unknown>;
  return z.string().min(1).parse(value._rev);
}

export function createInboxRepository(database: Database = db) {
  return {
    async getByConnector(organizationKey: string, scopeKey: string, connectorKey: string): Promise<(Inbox & { revision: string }) | null> {
      const cursor = await database.query('FOR inbox IN inboxes FILTER inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey == @connectorKey LIMIT 1 RETURN inbox', { organizationKey, scopeKey, connectorKey });
      const raw = await cursor.next();
      return raw ? { ...parse(raw), revision: revision(raw) } : null;
    },
    async search(organizationKey: string, scopeKey: string, connectorKeys: string[], embedding: number[], query: string, minimumScore: number, limit: number) {
      if (!connectorKeys.length) return [];
      const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR inbox IN inboxes
        FILTER inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey IN @connectorKeys
        FILTER IS_ARRAY(inbox.embedding) && LENGTH(inbox.embedding) == LENGTH(@embedding)
        LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", inbox.name, inbox.description)), @query)
        LET score = COSINE_SIMILARITY(inbox.embedding, @embedding)
        FILTER direct || (IS_NUMBER(score) && score >= @minimumScore)
        SORT direct DESC, score DESC, inbox.updatedAt DESC, inbox._key ASC
        LIMIT @limit
        RETURN { inbox, score: direct ? 1 : score }`, { organizationKey, scopeKey, connectorKeys, embedding, query: normalizedQuery, minimumScore, limit });
      return (await cursor.all() as Array<{ inbox: unknown; score: number }>).map(({ inbox, score }) => ({ inbox: parse(inbox), score }));
    },
    async ensure(connector: OrganizationConnector, metadata: { name: string; description?: string }, embedding: number[], overwrite: boolean, expectedRevision?: string | null): Promise<(Inbox & { revision: string }) | null> {
      const timestamp = new Date().toISOString();
      const document = inboxSchema.parse({ key: newId(), organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, connectorKey: connector.key, ...metadata, isFavorite: false, embedding, createdAt: timestamp, updatedAt: timestamp });
      try {
        const cursor = await database.query(`LET existing = FIRST(FOR inbox IN inboxes FILTER inbox.connectorKey == @connectorKey LIMIT 1 RETURN inbox)
          FILTER existing == null ? @expectedRevision == null : (!@overwrite || existing._rev == @expectedRevision)
          UPSERT { connectorKey: @connectorKey }
          INSERT @document
          UPDATE (@overwrite ? MERGE(OLD, { name: @name, description: @description, embedding: @embedding, updatedAt: @updatedAt }) : {})
          IN inboxes OPTIONS { keepNull: false } RETURN NEW`, { connectorKey: connector.key, document: toArangoDoc(document), overwrite, expectedRevision: expectedRevision ?? null, name: metadata.name, description: metadata.description ?? null, embedding, updatedAt: timestamp });
        const raw = await cursor.next();
        return raw ? { ...parse(raw), revision: revision(raw) } : null;
      } catch (error) {
        if (!isArangoUniqueConstraintError(error)) throw error;
        const existing = await this.getByConnector(connector.organizationKey, connector.scopeKey, connector.key);
        if (!existing) throw error;
        if (!overwrite || expectedRevision === undefined || existing.revision === expectedRevision) return existing;
        return null;
      }
    },
    async update(organizationKey: string, scopeKey: string, connectorKey: string, expectedUpdatedAt: string, patch: { name?: string; description?: string | null; coverImageKey?: string | null; isFavorite?: boolean; embedding?: number[] }): Promise<{ inbox: Inbox; coverStorageKey?: string } | null> {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR inbox IN inboxes
        FILTER inbox.organizationKey == @organizationKey && inbox.scopeKey == @scopeKey && inbox.connectorKey == @connectorKey && inbox.updatedAt == @expectedUpdatedAt
        LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
        FILTER !@setCover || @coverImageKey == null || (cover != null && cover.scopeKey == @scopeKey)
        LET update = MERGE(
          @setName ? { name: @name } : {},
          @setDescription ? { description: @description } : {},
          @setCover ? { coverImageKey: @coverImageKey } : {},
          @setFavorite ? { isFavorite: @isFavorite } : {},
          @setEmbedding ? { embedding: @embedding } : {},
          { updatedAt: @updatedAt })
        UPDATE inbox WITH update IN inboxes OPTIONS { keepNull: false }
        RETURN { inbox: NEW, coverStorageKey: cover.storageKey }`, {
        organizationKey, scopeKey, connectorKey, expectedUpdatedAt, updatedAt,
        setName: patch.name !== undefined, name: patch.name ?? null,
        setDescription: Object.prototype.hasOwnProperty.call(patch, 'description'), description: patch.description ?? null,
        setCover: Object.prototype.hasOwnProperty.call(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null,
        setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false,
        setEmbedding: patch.embedding !== undefined, embedding: patch.embedding ?? null,
      });
      const raw = await cursor.next() as { inbox: Record<string, unknown>; coverStorageKey?: string } | undefined;
      return raw ? { inbox: parse(raw.inbox), ...(raw.coverStorageKey ? { coverStorageKey: raw.coverStorageKey } : {}) } : null;
    },
    async coverStorageKey(scopeKey: string, coverImageKey?: string): Promise<string | undefined> {
      if (!coverImageKey) return undefined;
      const cursor = await database.query('FOR image IN images FILTER image._key == @coverImageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN image.storageKey', { scopeKey, coverImageKey });
      return (await cursor.next()) ?? undefined;
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
