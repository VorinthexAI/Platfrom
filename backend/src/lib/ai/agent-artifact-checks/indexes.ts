import { db } from '@/lib/db/client';
import { AGENT_ARTIFACT_CHECKS_COLLECTION } from './schema';
export async function ensureAgentArtifactChecksCollection(database = db) {
  const collection = database.collection(AGENT_ARTIFACT_CHECKS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['agentRunKey', 'createdAt'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['candidateNodeType', 'candidateNodeKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['comparedNodeType', 'comparedNodeKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['decision'], unique: false });
}
