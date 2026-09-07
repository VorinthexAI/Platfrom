import { AiError } from '@/lib/ai/shared/result';
import type { Scope, ScopeScope } from './schema';
import type { db } from '@/lib/db/client';

export interface CreateScopeInput {
  key?: string;
  teamKey: string;
  slug: string;
  name: string;
  summary: string;
  description: string | null;
  position: number;
  level?: number;
}

export interface ScopeRepository {
  createScope(input: CreateScopeInput): Promise<Scope>;
  updateScope(scopeKey: string, input: Partial<Pick<CreateScopeInput, 'slug' | 'name' | 'summary' | 'description' | 'position' | 'level'>>): Promise<Scope>;
  getScopeByKey(scopeKey: string): Promise<Scope | null>;
  listScopes(teamKey: string): Promise<readonly Scope[]>;
  removeScope(scopeKey: string, exclusiveOwnerUserKey?: string): Promise<void>;

  addScopeRelation(parentKey: string, childKey: string): Promise<ScopeScope>;
  removeScopeRelation(parentKey: string, childKey: string): Promise<void>;
  listChildRelations(parentKey: string): Promise<readonly ScopeScope[]>;
}

export class DuplicateScopeSlugError extends AiError {
  constructor(teamKey: string, slug: string) {
    super('duplicate_scope_slug', `Team ${teamKey} already has scope slug ${slug}`);
  }
}

export class ScopeNotFoundError extends AiError {
  constructor(scopeKey: string) {
    super('scope_not_found', `Scope not found: ${scopeKey}`);
  }
}

export class ScopeTeamMismatchError extends AiError {
  constructor(parentKey: string, childKey: string) {
    super(
      'scope_team_mismatch',
      `Scopes ${parentKey} and ${childKey} belong to different teams`,
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

export class ProductScopeMutationError extends AiError {
  constructor(scopeKey: string) {
    super('product_scope_protected', `Designated product scope ${scopeKey} cannot be deleted or reparented`);
  }
}

export interface ScopesDatabase {
  beginTransaction?: typeof db.beginTransaction;
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
