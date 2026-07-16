import { db } from '@/lib/db/client';
import { SCOPE_MEMBERS_COLLECTION, SCOPE_SCOPES_COLLECTION, SCOPES_COLLECTION } from './schema';
import type { ScopesSetupDatabase } from './types';

export async function ensureScopesCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPES_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'slug'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'position'], unique: false });
}

export async function ensureScopeScopesCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPE_SCOPES_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['parentKey', 'childKey'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['childKey'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['parentKey'], unique: false });
}

export async function ensureScopeMembersCollection(database: ScopesSetupDatabase = db): Promise<void> {
  const collection = database.collection(SCOPE_MEMBERS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'userOrganizationKey'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeKey'], unique: false });
  await collection.ensureIndex({ type: 'persistent', fields: ['userOrganizationKey'], unique: false });
}
