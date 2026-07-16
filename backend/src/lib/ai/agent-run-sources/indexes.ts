import { db } from '@/lib/db/client';
import { AGENT_RUN_SOURCES_COLLECTION } from './schema';
export async function ensureAgentRunSourcesCollection(database = db) {
  const collection = database.collection(AGENT_RUN_SOURCES_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey', 'nodeType', 'nodeKey'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey', 'priority'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['nodeType', 'nodeKey'], unique: false });
}
