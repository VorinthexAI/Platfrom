import { db } from '@/lib/db/client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import {
  ARTIFACT_DEPENDENCIES_COLLECTION,
  ARTIFACT_SNAPSHOTS_COLLECTION,
  ARTIFACTS_COLLECTION,
  artifactDependencySchema,
  artifactSchema,
  artifactSnapshotSchema,
  type Artifact,
  type ArtifactDependency,
  type ArtifactSnapshot,
} from './schema';

interface ArtifactDatabase {
  collection(name: string): {
    document(key: string): Promise<unknown>;
    save(doc: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(key: string, patch: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    remove(key: string): Promise<unknown>;
  };
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
}

export interface ArtifactRepository {
  insertArtifact(artifact: Artifact): Promise<Artifact>;
  updateArtifact(key: string, patch: Pick<Artifact, 'name' | 'definition' | 'snapshotKey' | 'updatedAt'>): Promise<Artifact>;
  getArtifact(key: string): Promise<Artifact | null>;
  listArtifacts(organizationKey: string, scopeKey: string): Promise<Artifact[]>;
  deleteArtifact(key: string): Promise<void>;
  replaceDependencies(artifactKey: string, dependencies: ArtifactDependency[]): Promise<void>;
  listDependencies(artifactKey: string): Promise<ArtifactDependency[]>;
  insertSnapshot(snapshot: ArtifactSnapshot): Promise<ArtifactSnapshot>;
  getSnapshot(key: string): Promise<ArtifactSnapshot | null>;
}

function savedDocument(result: unknown): Record<string, unknown> | null {
  return (result as { new?: Record<string, unknown> }).new ?? null;
}

export function createArtifactRepository(database: ArtifactDatabase = db as unknown as ArtifactDatabase): ArtifactRepository {
  return {
    async insertArtifact(artifact) {
      const parsed = artifactSchema.parse(artifact);
      const result = await database.collection(ARTIFACTS_COLLECTION).save(toArangoDoc(parsed), { returnNew: true });
      return artifactSchema.parse(withArangoKey(savedDocument(result) ?? toArangoDoc(parsed)));
    },
    async updateArtifact(key, patch) {
      const result = await database.collection(ARTIFACTS_COLLECTION).update(key, patch, { returnNew: true, mergeObjects: false });
      return artifactSchema.parse(withArangoKey(savedDocument(result)!));
    },
    async getArtifact(key) {
      try {
        const document = await database.collection(ARTIFACTS_COLLECTION).document(key);
        return artifactSchema.parse(withArangoKey(document as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },
    async listArtifacts(organizationKey, scopeKey) {
      const cursor = await database.query(`
        FOR artifact IN @@collection
          FILTER artifact.organizationKey == @organizationKey && artifact.scopeKey == @scopeKey
          SORT artifact.updatedAt DESC, artifact._key ASC
          RETURN artifact
      `, { '@collection': ARTIFACTS_COLLECTION, organizationKey, scopeKey });
      return (await cursor.all()).map((doc) => artifactSchema.parse(withArangoKey(doc as Record<string, unknown>)));
    },
    async deleteArtifact(key) {
      await database.query('FOR dependency IN @@collection FILTER dependency.artifactKey == @key REMOVE dependency IN @@collection', { '@collection': ARTIFACT_DEPENDENCIES_COLLECTION, key });
      await database.query('FOR snapshot IN @@collection FILTER snapshot.artifactKey == @key REMOVE snapshot IN @@collection', { '@collection': ARTIFACT_SNAPSHOTS_COLLECTION, key });
      await database.collection(ARTIFACTS_COLLECTION).remove(key);
    },
    async replaceDependencies(artifactKey, dependencies) {
      await database.query('FOR dependency IN @@collection FILTER dependency.artifactKey == @artifactKey REMOVE dependency IN @@collection', { '@collection': ARTIFACT_DEPENDENCIES_COLLECTION, artifactKey });
      for (const dependency of dependencies) await database.collection(ARTIFACT_DEPENDENCIES_COLLECTION).save(toArangoDoc(artifactDependencySchema.parse(dependency)));
    },
    async listDependencies(artifactKey) {
      const cursor = await database.query('FOR dependency IN @@collection FILTER dependency.artifactKey == @artifactKey SORT dependency._key RETURN dependency', { '@collection': ARTIFACT_DEPENDENCIES_COLLECTION, artifactKey });
      return (await cursor.all()).map((doc) => artifactDependencySchema.parse(withArangoKey(doc as Record<string, unknown>)));
    },
    async insertSnapshot(snapshot) {
      const parsed = artifactSnapshotSchema.parse(snapshot);
      const result = await database.collection(ARTIFACT_SNAPSHOTS_COLLECTION).save(toArangoDoc(parsed), { returnNew: true });
      return artifactSnapshotSchema.parse(withArangoKey(savedDocument(result) ?? toArangoDoc(parsed)));
    },
    async getSnapshot(key) {
      try {
        const document = await database.collection(ARTIFACT_SNAPSHOTS_COLLECTION).document(key);
        return artifactSnapshotSchema.parse(withArangoKey(document as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },
  };
}

let defaultRepository: ArtifactRepository | null = null;
export function getDefaultArtifactRepository(): ArtifactRepository {
  defaultRepository ??= createArtifactRepository();
  return defaultRepository;
}
