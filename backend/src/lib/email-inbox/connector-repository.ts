import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { decryptEmailConnectorCredentials, encryptEmailConnectorCredentials, tokenFingerprint } from './connector-crypto';
import { ORGANIZATION_CONNECTORS_COLLECTION, organizationConnectorSchema, type EmailConnectorCredentials, type OrganizationConnector } from './connector-schema';
import { ensureMailFolders } from './folders';

type Database = Pick<typeof db, 'query' | 'collection'>;
export type ConnectorPublic = Omit<OrganizationConnector, 'encryptedCredentials' | 'encryptionKeyId' | 'accessTokenFingerprint' | 'syncLeaseToken' | 'syncLeaseExpiresAt'>;

function parse(raw: unknown) {
  return organizationConnectorSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

export function connectorPublic(connector: OrganizationConnector): ConnectorPublic {
  const { encryptedCredentials: _encrypted, encryptionKeyId: _keyId, accessTokenFingerprint: _fingerprint, syncLeaseToken: _leaseToken, syncLeaseExpiresAt: _leaseExpiresAt, ...safe } = connector;
  return safe;
}

export function createConnectorRepository(database: Database = db) {
  async function find(scopeKey: string, providerAccountId?: string): Promise<OrganizationConnector | null> {
    const cursor = await database.query(`
      FOR connector IN @@collection
        FILTER connector.scopeKey == @scopeKey && connector.provider == "gmail"
        FILTER @providerAccountId == null || connector.providerAccountId == @providerAccountId
        FILTER connector.status != "revoked"
        SORT connector.updatedAt DESC
        LIMIT 1
        RETURN connector
    `, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, scopeKey, providerAccountId: providerAccountId ?? null });
    const raw = await cursor.next();
    return raw ? parse(raw) : null;
  }

  return {
    find,
    async getByKey(key: string): Promise<OrganizationConnector | null> {
      const raw = await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).document(key).catch(() => null);
      return raw ? parse(raw) : null;
    },
    async upsert(input: {
      organizationKey: string; scopeKey: string; providerAccountId: string; email: string; scopes: string[];
      createdByMembershipKey: string; credentials: EmailConnectorCredentials;
    }) {
      const timestamp = new Date().toISOString();
      const binding = { organizationKey: input.organizationKey, scopeKey: input.scopeKey, providerAccountId: input.providerAccountId };
      const encrypted = encryptEmailConnectorCredentials(input.credentials, binding);
      const document = organizationConnectorSchema.parse({
        key: newId(), ...input, ...encrypted, credentials: undefined,
        accessTokenFingerprint: tokenFingerprint(input.credentials.accessToken), status: 'active', syncEnabled: true, syncStatus: 'idle',
        lastRefreshedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      });
      try {
        const cursor = await database.query(`
          UPSERT { organizationKey: @organizationKey, scopeKey: @scopeKey, provider: "gmail" }
          INSERT @document
          UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt })
          IN @@collection OPTIONS { keepNull: false }
          RETURN NEW
        `, {
          '@collection': ORGANIZATION_CONNECTORS_COLLECTION,
          organizationKey: input.organizationKey,
          scopeKey: input.scopeKey,
          providerAccountId: input.providerAccountId,
          document: toArangoDoc(document),
        });
        const connector = parse(await cursor.next());
        await ensureMailFolders(database, input.scopeKey);
        return connector;
      } catch (error) {
        if (!isArangoUniqueConstraintError(error)) throw error;
        const existing = await find(input.scopeKey, input.providerAccountId);
        if (!existing) throw error;
        return existing;
      }
    },
    credentials(connector: OrganizationConnector) {
      return decryptEmailConnectorCredentials(connector.encryptedCredentials, connector.encryptionKeyId, connector);
    },
    async updateCredentials(connector: OrganizationConnector, credentials: EmailConnectorCredentials) {
      const encrypted = encryptEmailConnectorCredentials(credentials, connector);
      const updatedAt = new Date().toISOString();
      const result = await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(connector.key, {
        ...encrypted, accessTokenFingerprint: tokenFingerprint(credentials.accessToken), status: 'active',
        lastRefreshedAt: updatedAt, lastError: null, updatedAt,
      }, { returnNew: true, keepNull: false });
      return parse((result as { new: Record<string, unknown> }).new);
    },
    async markError(key: string, message: string) {
      await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(key, { status: 'error', lastError: message.slice(0, 500), updatedAt: new Date().toISOString() });
    },
    async markActive(key: string) {
      await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(key, { status: 'active', lastError: null, updatedAt: new Date().toISOString() }, { keepNull: false });
    },
    async listSyncTargetsByEmail(email: string) {
      const cursor = await database.query(`FOR connector IN @@collection FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false && LOWER(connector.email) == @email RETURN { organizationKey: connector.organizationKey, scopeKey: connector.scopeKey }`, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, email: email.toLowerCase() });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string }>>;
    },
    async listWatchRenewalTargets(before: string) {
      const cursor = await database.query(`FOR connector IN @@collection FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false && (connector.watchExpiresAt == null || connector.watchExpiresAt <= @before) RETURN { organizationKey: connector.organizationKey, scopeKey: connector.scopeKey }`, { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, before });
      return cursor.all() as Promise<Array<{ organizationKey: string; scopeKey: string }>>;
    },
    async claimSync(key: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.status != "revoked" && connector.syncEnabled != false && (connector.syncLeaseExpiresAt == null || connector.syncLeaseExpiresAt <= @now) UPDATE connector WITH { syncLeaseToken: @token, syncLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt, now: new Date().toISOString() });
      return (await cursor.next()) === true;
    },
    async renewSync(key: string, token: string, expiresAt: string) {
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.syncLeaseToken == @token UPDATE connector WITH { syncLeaseExpiresAt: @expiresAt } IN @@collection RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token, expiresAt });
      return (await cursor.next()) === true;
    },
    async releaseSync(key: string, token: string) {
      await database.query('FOR connector IN @@collection FILTER connector._key == @key && connector.syncLeaseToken == @token UPDATE connector WITH { syncLeaseToken: null, syncLeaseExpiresAt: null } IN @@collection OPTIONS { keepNull: false }', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, token });
    },
    async setSyncState(key: string, status: 'idle' | 'syncing' | 'error', input: { historyId?: string; pendingHistoryId?: string | null; pendingThreadIds?: string[] | null; resetLastSynced?: boolean; error?: string; markSynced?: boolean; leaseToken?: string } = {}) {
      const updatedAt = new Date().toISOString();
      const update = { syncStatus: status, syncError: input.error?.slice(0, 500) ?? null, historyId: input.historyId, syncPendingHistoryId: input.pendingHistoryId, syncPendingThreadIds: input.pendingThreadIds, ...(input.resetLastSynced ? { lastSyncedAt: null } : {}), ...(status === 'idle' && input.markSynced !== false ? { status: 'active', lastError: null, lastSyncedAt: updatedAt } : {}), ...(status === 'error' ? { status: 'error', lastError: input.error?.slice(0, 500) ?? 'Email synchronization failed' } : {}), updatedAt };
      const cursor = await database.query('FOR connector IN @@collection FILTER connector._key == @key && (@leaseToken == null || connector.syncLeaseToken == @leaseToken) UPDATE connector WITH @update IN @@collection OPTIONS { keepNull: false } RETURN true', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, key, leaseToken: input.leaseToken ?? null, update });
      return (await cursor.next()) === true;
    },
    async updateWatch(key: string, input: { historyId: string; expiration: string }) {
      const updatedAt = new Date().toISOString();
      await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(key, { watchRegisteredAt: updatedAt, watchExpiresAt: new Date(Number(input.expiration)).toISOString(), updatedAt });
    },
    async disableScope(scopeKey: string) {
      await database.query('FOR connector IN @@collection FILTER connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.syncEnabled != false UPDATE connector WITH { syncEnabled: false, syncStatus: "idle", updatedAt: @updatedAt } IN @@collection', { '@collection': ORGANIZATION_CONNECTORS_COLLECTION, scopeKey, updatedAt: new Date().toISOString() });
    },
    async revoke(key: string) {
      const timestamp = new Date().toISOString();
      await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(key, {
        status: 'revoked', revokedAt: timestamp, encryptedCredentials: 'revoked', accessTokenFingerprint: tokenFingerprint(`revoked:${key}:${timestamp}`), updatedAt: timestamp,
      });
    },
  };
}

export type ConnectorRepository = ReturnType<typeof createConnectorRepository>;
