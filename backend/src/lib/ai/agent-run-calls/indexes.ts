import { db } from '@/lib/db/client';
import { AGENT_RUN_CALLS_COLLECTION } from './schema';

export async function ensureAgentRunCallsCollection(database = db) {
  const collection = database.collection(AGENT_RUN_CALLS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  for (const fields of [['agentRunKey'], ['agentRunStepKey'], ['skillKey'], ['actionKey'], ['modelKey'], ['providerKey']] as const) {
    await collection.ensureIndex({ type: 'persistent', fields: [...fields], unique: false });
  }
}
