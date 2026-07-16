import { db } from '@/lib/db/client';
import { RUNTIME_VARIABLES_COLLECTION } from './schema';

export async function ensureRuntimeVariablesCollection(database = db) {
  const collection = database.collection(RUNTIME_VARIABLES_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'scopeKey', 'agentKey', 'name'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentKey'], unique: false });
}
