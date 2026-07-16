import { db } from '@/lib/db/client';
import { AGENT_RUN_STEPS_COLLECTION } from './schema';

export async function ensureAgentRunStepsCollection(database = db) {
  const collection = database.collection(AGENT_RUN_STEPS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey', 'stepSlug'], unique: false });
}
