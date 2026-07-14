import { db } from '@/lib/db/client';
import { AGENT_RUNS_COLLECTION } from './schema';
import type { AgentRunsSetupDatabase } from './types';

/**
 * Idempotent setup for `agent_runs`: creates the collection when missing
 * and ensures the read-path indexes (per-organization and per-agent
 * timelines, status sweeps). Safe to run on every deploy — called from
 * `src/db/arango-migrate.ts`.
 */
export async function ensureAgentRunsCollection(database: AgentRunsSetupDatabase = db): Promise<void> {
  const collection = database.collection(AGENT_RUNS_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationId', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentId', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['status'], unique: false });
}
