import { db } from '@/lib/db/client';
import { USER_CONNECTORS_COLLECTION } from './connector-schema';

export async function ensureUserConnectorsCollection(database: Pick<typeof db, 'collection' | 'query'> = db) {
  const collection = database.collection(USER_CONNECTORS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  const duplicates = await database.query<number>('RETURN LENGTH(FOR connector IN userConnectors COLLECT userKey = connector.userKey, provider = connector.provider, providerAccountId = connector.providerAccountId WITH COUNT INTO count FILTER count > 1 RETURN 1)');
  if ((await duplicates.next() ?? 0) > 0) throw new Error('userConnectors contains duplicate provider-account bindings');
  await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'provider', 'providerAccountId'], unique: true });
  for (const index of await collection.indexes()) {
    const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
    if (fields.join(',') === 'teamKey,scopeKey,provider' || fields.join(',') === 'teamKey,scopeKey,provider,providerAccountId') await collection.dropIndex(index.id);
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['userKey', 'provider', 'status'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['email', 'syncEnabled'] });
  await collection.ensureIndex({ type: 'persistent', fields: ['syncEnabled', 'watchExpiresAt'] });
}

/** @deprecated Use ensureUserConnectorsCollection. */
export const ensureTeamConnectorsCollection = ensureUserConnectorsCollection;
