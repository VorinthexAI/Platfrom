import { db } from '@/lib/db/client';
import { AGENT_ARTIFACTS_COLLECTION } from './schema';
export async function ensureAgentArtifactsCollection(database = db) {
  const collection = database.collection(AGENT_ARTIFACTS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['artifactKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey', 'artifactKey', 'relation'], unique: true });
}
