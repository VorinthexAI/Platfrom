import { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, withArangoKey } from '@/lib/db/base';
import { inboxSchema, type Inbox } from './inbox-schema';
import type { OrganizationConnector } from './connector-schema';
import { ensureMailFolders, mailFolderKeys, mailInboxFolderKey } from './folders';

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
      const cursor = await database.query(`FOR connector IN organizationConnectors
        FILTER connector._key == @connectorKey && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked"
        LET folder = DOCUMENT(folders, @folderKey)
        LET parent = folder == null ? null : DOCUMENT(folders, folder.parentFolderKey)
        FILTER folder != null && folder.scopeKey == @scopeKey && folder.managedPurpose == "mail-inbox" && folder.managedOwnerKey == connector._key && folder.mutationPolicy == "system-container"
        FILTER parent != null && parent.scopeKey == @scopeKey && parent.purpose == "communication-mail-inboxes"
        LIMIT 1 RETURN MERGE(folder, { organizationKey: connector.organizationKey, connectorKey: connector._key })`, { organizationKey, scopeKey, connectorKey, folderKey: mailInboxFolderKey(scopeKey, connectorKey) });
      const raw = await cursor.next();
      return raw ? { ...parse(raw), revision: revision(raw) } : null;
    },
    async search(organizationKey: string, scopeKey: string, connectorKeys: string[], embedding: number[], query: string, minimumScore: number, limit: number) {
      if (!connectorKeys.length) return [];
      const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR connector IN organizationConnectors
        FILTER connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked" && connector._key IN @connectorKeys
        LET folderKey = CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", connector._key))), 24))
        LET folder = DOCUMENT(folders, folderKey)
        LET parent = folder == null ? null : DOCUMENT(folders, folder.parentFolderKey)
        FILTER folder != null && folder.scopeKey == @scopeKey && folder.managedPurpose == "mail-inbox" && folder.managedOwnerKey == connector._key && folder.mutationPolicy == "system-container"
        FILTER parent != null && parent.scopeKey == @scopeKey && parent.purpose == "communication-mail-inboxes"
        FILTER IS_ARRAY(folder.embedding) && LENGTH(folder.embedding) == LENGTH(@embedding)
        LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", folder.name, folder.description)), @query)
        LET score = COSINE_SIMILARITY(folder.embedding, @embedding)
        FILTER direct || (IS_NUMBER(score) && score >= @minimumScore)
        SORT direct DESC, score DESC, folder.updatedAt DESC, folder._key ASC
        LIMIT @limit
        RETURN { inbox: MERGE(folder, { organizationKey: connector.organizationKey, connectorKey: connector._key }), score: direct ? 1 : score }`, { organizationKey, scopeKey, connectorKeys, embedding, query: normalizedQuery, minimumScore, limit });
      return (await cursor.all() as Array<{ inbox: unknown; score: number }>).map(({ inbox, score }) => ({ inbox: parse(inbox), score }));
    },
    async ensure(connector: OrganizationConnector, metadata: { name: string; description?: string }, embedding: number[], overwrite: boolean, expectedRevision?: string | null): Promise<(Inbox & { revision: string }) | null> {
      await ensureMailFolders(database, connector.scopeKey);
      const timestamp = new Date().toISOString();
      const key = mailInboxFolderKey(connector.scopeKey, connector.key);
      try {
        const cursor = await database.query(`LET connector = DOCUMENT(organizationConnectors, @connectorKey)
          FILTER connector != null && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail"
          LET parent = DOCUMENT(folders, @parentFolderKey)
          FILTER parent != null && parent.scopeKey == @scopeKey && parent.purpose == "communication-mail-inboxes"
          LET existing = DOCUMENT(folders, @key)
          FILTER existing == null ? @expectedRevision == null : (!@overwrite || existing._rev == @expectedRevision)
          LET folder = FIRST(UPSERT { _key: @key }
            INSERT MERGE({ _key: @key, scopeKey: @scopeKey, parentFolderKey: @parentFolderKey, name: @name, managedPurpose: "mail-inbox", managedOwnerKey: @connectorKey, mutationPolicy: "system-container", archiveVisibility: "visible", embedding: @embedding, isFavorite: false, createdAt: @updatedAt, updatedAt: @updatedAt }, @description == null ? {} : { description: @description })
            UPDATE (@overwrite && OLD.scopeKey == @scopeKey && OLD.managedPurpose == "mail-inbox" && OLD.managedOwnerKey == @connectorKey ? { parentFolderKey: @parentFolderKey, name: @name, description: @description, embedding: @embedding, updatedAt: @updatedAt } : {})
            IN folders OPTIONS { keepNull: false } RETURN NEW)
          FILTER folder.scopeKey == @scopeKey && folder.managedPurpose == "mail-inbox" && folder.managedOwnerKey == @connectorKey && folder.mutationPolicy == "system-container"
          RETURN MERGE(folder, { organizationKey: connector.organizationKey, connectorKey: connector._key })`, { key, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, parentFolderKey: mailFolderKeys(connector.scopeKey).inboxes, connectorKey: connector.key, overwrite, expectedRevision: expectedRevision ?? null, name: metadata.name, description: metadata.description ?? null, embedding, updatedAt: timestamp });
        const raw = await cursor.next();
        if (!raw) return null;
        const inbox = parse(raw);
        return { ...inbox, revision: revision(raw) };
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
      const cursor = await database.query(`FOR connector IN organizationConnectors
        FILTER connector._key == @connectorKey && connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked"
        LET inbox = DOCUMENT(folders, @folderKey)
        LET parent = inbox == null ? null : DOCUMENT(folders, inbox.parentFolderKey)
        FILTER inbox != null && inbox.scopeKey == @scopeKey && inbox.managedPurpose == "mail-inbox" && inbox.managedOwnerKey == connector._key && inbox.mutationPolicy == "system-container" && inbox.updatedAt == @expectedUpdatedAt
        FILTER parent != null && parent.scopeKey == @scopeKey && parent.purpose == "communication-mail-inboxes"
        LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
        FILTER !@setCover || @coverImageKey == null || (cover != null && cover.scopeKey == @scopeKey)
        LET update = MERGE(
          @setName ? { name: @name } : {},
          @setDescription ? { description: @description } : {},
          @setCover ? { coverImageKey: @coverImageKey } : {},
          @setFavorite ? { isFavorite: @isFavorite } : {},
          @setEmbedding ? { embedding: @embedding } : {},
          { updatedAt: @updatedAt })
        UPDATE inbox WITH update IN folders OPTIONS { keepNull: false }
        RETURN { inbox: MERGE(NEW, { organizationKey: connector.organizationKey, connectorKey: connector._key }), coverStorageKey: cover.storageKey }`, {
        organizationKey, scopeKey, connectorKey, folderKey: mailInboxFolderKey(scopeKey, connectorKey), expectedUpdatedAt, updatedAt,
        setName: patch.name !== undefined, name: patch.name ?? null,
        setDescription: Object.prototype.hasOwnProperty.call(patch, 'description'), description: patch.description ?? null,
        setCover: Object.prototype.hasOwnProperty.call(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null,
        setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false,
        setEmbedding: patch.embedding !== undefined, embedding: patch.embedding ?? null,
      });
      const raw = await cursor.next() as { inbox: Record<string, unknown>; coverStorageKey?: string } | undefined;
      if (!raw) return null;
      const inbox = parse(raw.inbox);
      return { inbox, ...(raw.coverStorageKey ? { coverStorageKey: raw.coverStorageKey } : {}) };
    },
    async coverStorageKey(scopeKey: string, coverImageKey?: string): Promise<string | undefined> {
      if (!coverImageKey) return undefined;
      const cursor = await database.query('FOR image IN images FILTER image._key == @coverImageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN image.storageKey', { scopeKey, coverImageKey });
      return (await cursor.next()) ?? undefined;
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
