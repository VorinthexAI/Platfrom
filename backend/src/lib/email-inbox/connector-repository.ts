import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { decryptEmailConnectorCredentials, encryptEmailConnectorCredentials, tokenFingerprint } from './connector-crypto';
import { ORGANIZATION_CONNECTORS_COLLECTION, organizationConnectorSchema, type EmailConnectorCredentials, type OrganizationConnector } from './connector-schema';

type Database = Pick<typeof db, 'query' | 'collection'>;
export type ConnectorPublic = Omit<OrganizationConnector, 'encryptedCredentials' | 'encryptionKeyId' | 'accessTokenFingerprint'>;

function parse(raw: unknown) {
  return organizationConnectorSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

export function connectorPublic(connector: OrganizationConnector): ConnectorPublic {
  const { encryptedCredentials: _encrypted, encryptionKeyId: _keyId, accessTokenFingerprint: _fingerprint, ...safe } = connector;
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
        accessTokenFingerprint: tokenFingerprint(input.credentials.accessToken), status: 'active',
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
        return parse(await cursor.next());
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
    async revoke(key: string) {
      const timestamp = new Date().toISOString();
      await database.collection(ORGANIZATION_CONNECTORS_COLLECTION).update(key, {
        status: 'revoked', revokedAt: timestamp, encryptedCredentials: 'revoked', accessTokenFingerprint: tokenFingerprint(`revoked:${key}:${timestamp}`), updatedAt: timestamp,
      });
    },
  };
}

export type ConnectorRepository = ReturnType<typeof createConnectorRepository>;
