import { AiError } from '@/lib/ai/shared/result';
import type { Scope, ScopeScope } from './schema';

export interface CreateScopeInput {
  organizationKey: string;
  slug: string;
  name: string;
  description: string;
}

export interface ScopeRepository {
  createScope(input: CreateScopeInput): Promise<Scope>;
  getScopeByKey(scopeKey: string): Promise<Scope | null>;
  listScopes(organizationKey: string): Promise<readonly Scope[]>;
  removeScope(scopeKey: string): Promise<void>;

  addScopeRelation(parentScopeKey: string, childScopeKey: string, position: number): Promise<ScopeScope>;
  removeScopeRelation(parentScopeKey: string, childScopeKey: string): Promise<void>;
  listChildRelations(parentScopeKey: string): Promise<readonly ScopeScope[]>;
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
  constructor(parentScopeKey: string, childScopeKey: string) {
    super(
      'scope_organization_mismatch',
      `Scopes ${parentScopeKey} and ${childScopeKey} belong to different organizations`,
    );
  }
}

export class DuplicateScopeRelationError extends AiError {
  constructor(parentScopeKey: string, childScopeKey: string) {
    super('duplicate_scope_relation', `Scope ${childScopeKey} is already linked under ${parentScopeKey}`);
  }
}

export class ScopeAlreadyHasParentError extends AiError {
  constructor(childScopeKey: string) {
    super('scope_already_has_parent', `Scope ${childScopeKey} already has a parent`);
  }
}

export class ScopePositionConflictError extends AiError {
  constructor(parentScopeKey: string, position: number) {
    super('scope_position_conflict', `Position ${position} is already used under scope ${parentScopeKey}`);
  }
}

export class ScopeCycleError extends AiError {
  constructor(parentScopeKey: string, childScopeKey: string) {
    super('scope_cycle', `Linking ${childScopeKey} under ${parentScopeKey} would create a cycle`);
  }
}

export class ScopeRelationNotFoundError extends AiError {
  constructor(parentScopeKey: string, childScopeKey: string) {
    super('scope_relation_not_found', `Scope relation ${parentScopeKey} -> ${childScopeKey} was not found`);
  }
}

export interface ScopesDatabase {
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

export interface ScopesSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
