import { db } from '@/lib/db/client';
import { AGENT_MEMORIES_COLLECTION } from './schema';
export async function ensureAgentMemoriesCollection(database = db) {
  const collection = database.collection(AGENT_MEMORIES_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'scopeKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'importance'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['skillKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['sourceRunKey'], unique: false });
}
