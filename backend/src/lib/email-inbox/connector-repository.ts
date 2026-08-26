import { z } from 'zod';
import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { decryptEmailConnectorCredentials, encryptEmailConnectorCredentials, tokenFingerprint } from './connector-crypto';
import { ORGANIZATION_CONNECTORS_COLLECTION, organizationConnectorSchema, type EmailConnectorCredentials, type EmailProvider, type OrganizationConnector } from './connector-schema';
import { ensureMailFolders } from './folders';
import { INBOXES_COLLECTION, inboxSchema, type Inbox } from './inbox-schema';

type Database = Pick<typeof db, 'query' | 'collection'>;
export type ConnectorPublic = Pick<OrganizationConnector, 'key' | 'organizationKey' | 'scopeKey' | 'provider' | 'email' | 'status' | 'syncEnabled' | 'syncStatus' | 'lastSyncedAt' | 'createdAt' | 'updatedAt'> & { syncError?: string };
type RevisionedConnector = OrganizationConnector & { revision: string };

function parse(raw: unknown) {
  return organizationConnectorSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

function revision(raw: unknown) {
  const value = raw as Record<string, unknown>;
  return z.string().min(1).parse(value._rev);
}

export function connectorPublic(connector: OrganizationConnector): ConnectorPublic {
  return {
    key: connector.key, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, provider: connector.provider,
    email: connector.email, status: connector.status, syncEnabled: connector.syncEnabled, syncStatus: connector.syncStatus,
    ...(connector.syncError ? { syncError: 'Email synchronization needs attention.' } : {}), ...(connector.lastSyncedAt ? { lastSyncedAt: connector.lastSyncedAt } : {}),
    createdAt: connector.createdAt, updatedAt: connector.updatedAt,
  };
}

export function createConnectorRepository(database: Database = db) {
  async function findExact(organizationKey: string, scopeKey: string, providerAccountId: string, provider: EmailProvider = 'gmail'): Promise<RevisionedConnector | null> {
    const cursor = await database.query(`
      FOR connector IN @@collection
        FILTER connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey
        FILTER connector.provider == @provider && connector.providerAccountId == @providerAccountId
        SORT connector.updatedAt DESC
        LIMIT 1
        RETURN connector
    `, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, organizationKey, scopeKey, providerAccountId, provider });
    const raw = await cursor.next();
    return raw ? { ...parse(raw), revision: revision(raw) } : null;
  }

  return {
    async listAuthorizedScope(organizationKey: string, scopeKey: string): Promise<OrganizationConnector[]> {
      const cursor = await database.query('FOR connector IN @@collection FILTER connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked" SORT connector.email ASC, connector._key ASC RETURN connector', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, organizationKey, scopeKey });
      return (await cursor.all()).map(parse);
    },
    findExact,
    async getExact(organizationKey: string, scopeKey: string, key: string): Promise<OrganizationConnector | null> {
      const raw = await (await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.provider == "gmail" LIMIT 1 RETURN connector', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key })).next();
      if (!raw) return null;
      const connector = parse(raw);
      return connector.organizationKey === organizationKey && connector.scopeKey === scopeKey ? connector : null;
    },
    async getByKey(key: string): Promise<OrganizationConnector | null> {
      const raw = await (await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.provider == "gmail" LIMIT 1 RETURN connector', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key })).next();
      return raw ? parse(raw) : null;
    },
    async upsert(input: {
       organizationKey: string; scopeKey: string; provider?: EmailProvider; providerAccountId: string; email: string; scopes: string[];
      createdByMembershipKey: string; credentials: EmailConnectorCredentials;
      initializeInactive?: boolean;
      expectedRevision?: string | null;
    }) {
      await ensureMailFolders(database, input.scopeKey);
      const timestamp = new Date().toISOString();
      const provider = input.provider ?? 'gmail';
      const binding = { organizationKey: input.organizationKey, scopeKey: input.scopeKey, providerAccountId: input.providerAccountId, provider };
      const encrypted = encryptEmailConnectorCredentials(input.credentials, binding);
      const { credentials: _credentials, initializeInactive = false, expectedRevision, ...persistedInput } = input;
      const fenceRevision = expectedRevision !== undefined;
      const document = organizationConnectorSchema.parse({
        key: newId(), ...persistedInput, provider, ...encrypted,
         accessTokenFingerprint: tokenFingerprint(input.credentials.accessToken), status: initializeInactive ? 'error' : 'active', syncEnabled: !initializeInactive, syncStatus: 'idle',
        ...(initializeInactive ? { lastError: 'Email connector initialization is incomplete' } : {}),
        lastRefreshedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      });
      try {
        const cursor = await database.query(`
          LET existing = FIRST(FOR connector IN @@collection FILTER connector.organizationKey == @organizationKey && connector.scopeKey == @scopeKey && connector.provider == @provider && connector.providerAccountId == @providerAccountId LIMIT 1 RETURN connector)
          FILTER !@fenceRevision || (existing == null ? @expectedRevision == null : existing._rev == @expectedRevision)
          UPSERT { organizationKey: @organizationKey, scopeKey: @scopeKey, provider: @provider, providerAccountId: @providerAccountId }
          INSERT @document
           UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt, revokedAt: null, historyId: null, lastSyncedAt: null, syncError: null, syncLeaseToken: null, syncLeaseExpiresAt: null, syncPendingHistoryId: null, syncPendingThreadIds: null, watchRegisteredAt: null, watchExpiresAt: null, lastError: null })
          IN @@collection OPTIONS { keepNull: false }
          RETURN NEW
        `, {
          '@collection': ORGANIZATION_CONNECTORS_COLLECTION,
          organizationKey: input.organizationKey,
          scopeKey: input.scopeKey,
           providerAccountId: input.providerAccountId,
           provider,
          fenceRevision,
          expectedRevision: expectedRevision ?? null,
          document: toArangoDoc(document),
        });
        const raw = await cursor.next();
        if (!raw) throw new Error('Email connector changed during OAuth callback');
        return { ...parse(raw), revision: revision(raw) };
      } catch (error) {
        if (!isArangoUniqueConstraintError(error) || fenceRevision) throw error;
        const existing = await findExact(input.organizationKey, input.scopeKey, input.providerAccountId, provider);
        if (!existing) throw error;
        return existing;
      }
    },
    credentials(connector: OrganizationConnector) {
      if (connector.status === 'revoked' || connector.encryptedCredentials === 'revoked') throw new Error('Revoked email credentials are unavailable');
      return decryptEmailConnectorCredentials(connector.encryptedCredentials, connector.encryptionKeyId, connector);
    },
    async updateCredentials(connector: OrganizationConnector, credentials: EmailConnectorCredentials) {
      const encrypted = encryptEmailConnectorCredentials(credentials, connector);
      const updatedAt = new Date().toISOString();
      const update = {
         ...encrypted, accessTokenFingerprint: tokenFingerprint(credentials.accessToken), status: 'active',
        lastRefreshedAt: updatedAt, lastError: null, updatedAt,
      };
      const cursor = await database.query('FOR current IN @@collection FILTER current._key == @key && current.updatedAt == @expectedUpdatedAt && current.status != "revoked" && current.syncEnabled != false UPDATE current WITH @update IN @@collection OPTIONS { keepNull: false } RETURN NEW', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key: connector.key, expectedUpdatedAt: connector.updatedAt, update });
      const raw = await cursor.next();
      return raw ? parse(raw) : null;
    },
    async activateInitialization(key: string, accessTokenFingerprint: string, expectedRevision?: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && (@expectedRevision == null || connector._rev == @expectedRevision) && connector.accessTokenFingerprint == @accessTokenFingerprint && connector.status == "error" && connector.syncEnabled == false UPDATE connector WITH { status: "active", syncEnabled: true, lastError: null, updatedAt: @updatedAt } IN @@collection OPTIONS { keepNull: false } RETURN NEW', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, expectedRevision: expectedRevision ?? null, accessTokenFingerprint, updatedAt });
      const raw = await cursor.next();
      return raw ? { ...parse(raw), revision: revision(raw) } : null;
    },
    async rollbackReconnect(input: { connectorKey: string; connectorRevision: string; previousConnector: OrganizationConnector | null; inboxRevision?: string; previousInbox: Inbox | null }) {
      const timestamp = new Date().toISOString();
      const connectorMutation = input.previousConnector
        ? 'REPLACE connector WITH @previousConnector IN @@collection'
        : 'UPDATE connector WITH { status: "revoked", syncEnabled: false, encryptedCredentials: "revoked", revokedAt: @timestamp, updatedAt: @timestamp } IN @@collection';
      const inboxMutation = input.inboxRevision
        ? input.previousInbox ? 'REPLACE inbox WITH @previousInbox IN @@inboxes' : 'REMOVE inbox IN @@inboxes'
        : '';
      const cursor = await database.query(`
        LET connector = DOCUMENT(@@collection, @connectorKey)
        LET inbox = FIRST(FOR current IN @@inboxes FILTER current.connectorKey == @connectorKey LIMIT 1 RETURN current)
        FILTER connector != null && connector._rev == @connectorRevision
        FILTER @inboxRevision == null || (inbox != null && inbox._rev == @inboxRevision)
        ${connectorMutation}
        ${inboxMutation}
        RETURN true
      `, {
        '@collection': ORGANIZATION_CONNECTORS_COLLECTION, '@inboxes': INBOXES_COLLECTION,
        connectorKey: input.connectorKey, connectorRevision: input.connectorRevision, inboxRevision: input.inboxRevision ?? null, timestamp,
        previousConnector: input.previousConnector ? toArangoDoc(organizationConnectorSchema.parse(input.previousConnector)) : null,
        previousInbox: input.previousInbox ? toArangoDoc(inboxSchema.parse(input.previousInbox)) : null,
      });
      return (await cursor.next()) === true;
    },
    async listSyncTargetsByEmail(email: string) {
      const cursor = await database.query(`FOR connector IN @@collection FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false && LOWER(connector.email) == @email RETURN { organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, connectorKey: connector._key }`, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, email: email.toLowerCase() });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string; connectorKey: string }>>;
    },
    async listWatchRenewalTargets(before: string) {
      const cursor = await database.query(`FOR connector IN @@collection FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false && (connector.watchExpiresAt == null || connector.watchExpiresAt <= @before) RETURN { organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, connectorKey: connector._key }`, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, before });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string; connectorKey: string }>>;
    },
    async claimSync(key: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status != "revoked" && connector.syncEnabled != false && (connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now) && (connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now) UPDATE connector WITH { syncLeaseToken: @token, syncLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt, now: new Date().toISOString() });
      return (await cursor.next()) === true;
    },
    async renewSync(key: string, token: string, expiresAt: string) {
      const now = new Date().toISOString();
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status != "revoked" && connector.syncEnabled != false && connector.syncLeaseToken == @token && connector.syncLeaseExpiresAt > @now UPDATE connector WITH { syncLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt, now });
      return (await cursor.next()) === true;
    },
    async releaseSync(key: string, token: string) {
      await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.syncLeaseToken == @token UPDATE connector WITH { syncLeaseToken: null, syncLeaseExpiresAt: null } IN @@collection OPTIONS { keepNull: false }', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token });
    },
    async claimSend(key: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status != "revoked" && connector.syncEnabled != false && (connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now) && (connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now) UPDATE connector WITH { sendLeaseToken: @token, sendLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt, now: new Date().toISOString() });
      return (await cursor.next()) === true;
    },
    async renewSend(key: string, token: string, expiresAt: string) {
      const now = new Date().toISOString();
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status == "active" && connector.syncEnabled != false && connector.sendLeaseToken == @token && connector.sendLeaseExpiresAt > @now UPDATE connector WITH { sendLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt, now });
      return (await cursor.next()) === true;
    },
    async releaseSend(key: string, token: string) {
      await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.sendLeaseToken == @token UPDATE connector WITH { sendLeaseToken: null, sendLeaseExpiresAt: null } IN @@collection OPTIONS { keepNull: false }', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token });
    },
    async setSyncState(key: string, status: 'idle' | 'syncing' | 'error', input: { historyId?: string; pendingHistoryId?: string | null; pendingThreadIds?: string[] | null; resetLastSynced?: boolean; error?: string; markSynced?: boolean; leaseToken?: string; expectedRevision?: string } = {}) {
      const updatedAt = new Date().toISOString();
      const update = { syncStatus: status, syncError: input.error?.slice(0, 500) ?? null, historyId: input.historyId, syncPendingHistoryId: input.pendingHistoryId, syncPendingThreadIds: input.pendingThreadIds, ...(input.resetLastSynced ? { lastSyncedAt: null } : {}), ...(status === 'syncing' ? { status: 'active', lastError: null } : {}), ...(status === 'idle' && input.markSynced !== false ? { status: 'active', lastError: null, lastSyncedAt: updatedAt } : {}), ...(status === 'error' ? { status: 'error', lastError: input.error?.slice(0, 500) ?? 'Email synchronization failed' } : {}), updatedAt };
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && (@expectedRevision == null || connector._rev == @expectedRevision) && (@leaseToken == null || connector.syncLeaseToken == @leaseToken) UPDATE connector WITH @update IN @@collection OPTIONS { keepNull: false } RETURN NEW', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, expectedRevision: input.expectedRevision ?? null, leaseToken: input.leaseToken ?? null, update });
      const raw = await cursor.next();
      return raw ? revision(raw) : null;
    },
    async updateWatch(key: string, input: { historyId: string; expiration: string }, expectedRevision?: string, expectedUpdatedAt?: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status != "revoked" && connector.syncEnabled != false && (@expectedRevision == null || connector._rev == @expectedRevision) && (@expectedUpdatedAt == null || connector.updatedAt == @expectedUpdatedAt) UPDATE connector WITH { watchRegisteredAt: @updatedAt, watchExpiresAt: @watchExpiresAt, updatedAt: @updatedAt } IN @@collection RETURN NEW', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, expectedRevision: expectedRevision ?? null, expectedUpdatedAt: expectedUpdatedAt ?? null, updatedAt, watchExpiresAt: new Date(Number(input.expiration)).toISOString() });
      const raw = await cursor.next();
      return raw ? revision(raw) : null;
    },
    async revoke(key: string, expectedUpdatedAt: string) {
      const timestamp = new Date().toISOString();
      const update = {
        status: 'revoked', syncEnabled: false, syncStatus: 'idle', revokedAt: timestamp, encryptedCredentials: 'revoked', accessTokenFingerprint: tokenFingerprint(`revoked:${key}:${timestamp}`),
        historyId: null, syncError: null, syncLeaseToken: null, syncLeaseExpiresAt: null, sendLeaseToken: null, sendLeaseExpiresAt: null, syncPendingHistoryId: null, syncPendingThreadIds: null, watchRegisteredAt: null, watchExpiresAt: null, lastError: null, updatedAt: timestamp,
      };
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.updatedAt == @expectedUpdatedAt && connector.status != "revoked" && (connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now) && (connector.sendLeaseExpiresAt == null || connector.sendLeaseExpiresAt <= @now) UPDATE connector WITH @update IN @@collection OPTIONS { keepNull: false } RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, expectedUpdatedAt, now: timestamp, update });
      return (await cursor.next()) === true;
    },
  };
}

export type ConnectorRepository = ReturnType<typeof createConnectorRepository>;
