import { db } from '@/lib/db/client';
import { AGENT_RUNS_COLLECTION } from './schema';
import type { AgentRunsSetupDatabase } from './types';

export async function ensureAgentRunsCollection(database: AgentRunsSetupDatabase = db): Promise<void> {
  const collection = database.collection(AGENT_RUNS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['userOrganizationKey', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['status', 'createdAt'], unique: false });
}
