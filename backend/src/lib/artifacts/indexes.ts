import { db } from '@/lib/db/client';
import { ARTIFACT_DEPENDENCIES_COLLECTION, ARTIFACT_SNAPSHOTS_COLLECTION, ARTIFACTS_COLLECTION } from './schema';

export async function ensureArtifactCollections(database = db) {
  const artifacts = database.collection(ARTIFACTS_COLLECTION);
  if (!(await artifacts.exists())) await artifacts.create();
  await artifacts.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'scopeKey', 'updatedAt'], unique: false });
  await artifacts.ensureIndex({ type: 'persistent', fields: ['snapshotKey'], unique: false, sparse: true });

  const snapshots = database.collection(ARTIFACT_SNAPSHOTS_COLLECTION);
  if (!(await snapshots.exists())) await snapshots.create();
  await snapshots.ensureIndex({ type: 'persistent', fields: ['artifactKey', 'createdAt'], unique: false });

  const dependencies = database.collection(ARTIFACT_DEPENDENCIES_COLLECTION);
  if (!(await dependencies.exists())) await dependencies.create();
  await dependencies.ensureIndex({ type: 'persistent', fields: ['artifactKey'], unique: false });
  await dependencies.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'scopeKey', 'dependencyType'], unique: false });
  await dependencies.ensureIndex({ type: 'persistent', fields: ['nodeType', 'nodeKey'], unique: false, sparse: true });
  await dependencies.ensureIndex({ type: 'persistent', fields: ['queryId'], unique: false, sparse: true });
  await dependencies.ensureIndex({ type: 'persistent', fields: ['referencedArtifactKey'], unique: false, sparse: true });
}
