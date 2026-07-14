import { AiError } from '@/lib/ai/shared/result';
import type { OrganizationScope } from './schema';

export interface OrganizationScopeRepository {
  createScope(name: string): Promise<OrganizationScope>;
  getScopeById(scopeId: string): Promise<OrganizationScope | null>;
  listScopes(): Promise<readonly OrganizationScope[]>;
  removeScope(scopeId: string): Promise<void>;
}

export class InvalidScopeNameError extends AiError {
  constructor() {
    super('invalid_scope_name', 'scope name must be a non-empty string');
  }
}

export class DuplicateOrganizationScopeError extends AiError {
  constructor(name: string) {
    super('duplicate_organization_scope', `An organization scope named ${name} already exists`);
  }
}

export class OrganizationScopeNotFoundError extends AiError {
  constructor(scopeId: string) {
    super('organization_scope_not_found', `Organization scope not found: ${scopeId}`);
  }
}

/** Narrow structural slice of an arangojs `Database` — fakeable in tests. */
export interface OrganizationScopesDatabase {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    remove(selector: string): Promise<unknown>;
    document(selector: string): Promise<unknown>;
  };
}

/** The slice used by idempotent collection/index setup. */
export interface OrganizationScopesSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
