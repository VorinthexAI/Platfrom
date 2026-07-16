import { AiError } from '@/lib/ai/shared/result';
import type { Scope, ScopeScope } from './schema';

export interface CreateScopeInput {
  key?: string;
  organizationKey: string;
  slug: string;
  name: string;
  description: string;
  position: number;
}

export interface ScopeRepository {
  createScope(input: CreateScopeInput): Promise<Scope>;
  updateScope(scopeKey: string, input: Partial<Pick<CreateScopeInput, 'name' | 'description' | 'position'>>): Promise<Scope>;
  getScopeByKey(scopeKey: string): Promise<Scope | null>;
  listScopes(organizationKey: string): Promise<readonly Scope[]>;
  removeScope(scopeKey: string): Promise<void>;

  addScopeRelation(parentKey: string, childKey: string): Promise<ScopeScope>;
  removeScopeRelation(parentKey: string, childKey: string): Promise<void>;
  listChildRelations(parentKey: string): Promise<readonly ScopeScope[]>;
}

export class DuplicateScopeSlugError extends AiError {
  constructor(organizationKey: string, slug: string) {
    super('duplicate_scope_slug', `Organization ${organizationKey} already has scope slug ${slug}`);
  }
}

export class ScopeNotFoundError extends AiError {
  constructor(scopeKey: string) {
    super('scope_not_found', `Scope not found: ${scopeKey}`);
  }
}

export class ScopeOrganizationMismatchError extends AiError {
  constructor(parentKey: string, childKey: string) {
    super(
      'scope_organization_mismatch',
      `Scopes ${parentKey} and ${childKey} belong to different organizations`,
    );
  }
}

export class DuplicateScopeRelationError extends AiError {
  constructor(parentKey: string, childKey: string) {
    super('duplicate_scope_relation', `Scope ${childKey} is already linked under ${parentKey}`);
  }
}

export class ScopeAlreadyHasParentError extends AiError {
  constructor(childKey: string) {
    super('scope_already_has_parent', `Scope ${childKey} already has a parent`);
  }
}

export class ScopeCycleError extends AiError {
  constructor(parentKey: string, childKey: string) {
    super('scope_cycle', `Linking ${childKey} under ${parentKey} would create a cycle`);
  }
}

export class ScopeRelationNotFoundError extends AiError {
  constructor(parentKey: string, childKey: string) {
    super('scope_relation_not_found', `Scope relation ${parentKey} -> ${childKey} was not found`);
  }
}

export interface ScopesDatabase {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    update(selector: string, patch: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    remove(selector: string): Promise<unknown>;
    document(selector: string): Promise<unknown>;
  };
}

export interface ScopesSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
