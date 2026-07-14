import { db } from '@/lib/db/client';
import { SCOPE_CHILDREN_COLLECTION, SCOPE_USERS_COLLECTION, SCOPES_COLLECTION } from './schema';
import type { ScopesSetupDatabase } from './types';

/**
 * Idempotent setup for `scopes`: an organization's scope names are unique
 * within that organization (never globally), plus a per-organization
 * listing index. Safe to run on every deploy — called from
 * `src/db/arango-migrate.ts`.
 */
export async function ensureScopesCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPES_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationId', 'name'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationId'], unique: false });
}

/**
 * Idempotent setup for `scopeChildren`: one link per (parent, child) pair,
 * with lookup indexes for walking the tree in both directions.
 */
export async function ensureScopeChildrenCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPE_CHILDREN_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['parentScopeId', 'childScopeId'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['parentScopeId'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['childScopeId'], unique: false });
}

/**
 * Idempotent setup for `scopeUsers`: a user is in a scope at most once,
 * with lookup indexes for both "who is in this scope" and "which scopes
 * does this user belong to".
 */
export async function ensureScopeUsersCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPE_USERS_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeId', 'userId'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeId'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['userId'], unique: false });
}
