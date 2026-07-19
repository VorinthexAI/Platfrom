import type { OrganizationCredential, OrganizationCredentials } from './schema';

export interface OrganizationCredentialsDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    update(key: string, patch: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
  };
}

export interface OrganizationCredentialsRepository {
  setCredentials(organizationKey: string, providerKey: string, credentials: OrganizationCredentials): Promise<OrganizationCredential>;
  getCredentials(organizationKey: string, providerKey: string): Promise<OrganizationCredentials | null>;
}

export interface OrganizationCredentialsSetupDatabase {
  collection(name: string): { exists(): Promise<boolean>; create(): Promise<unknown>; ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown> };
}
