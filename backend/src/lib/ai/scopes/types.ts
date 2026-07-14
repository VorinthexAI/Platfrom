import { AiError } from '@/lib/ai/shared/result';
import type { Scope, ScopeChild, ScopeUser } from './schema';

export interface CreateScopeInput {
  organizationId: string;
  name: string;
  description: string;
}

export interface ScopeRepository {
  createScope(input: CreateScopeInput): Promise<Scope>;
  getScopeById(scopeId: string): Promise<Scope | null>;
  listScopes(organizationId: string): Promise<readonly Scope[]>;
  /** Removes the scope AND every child/user link that references it. */
  removeScope(scopeId: string): Promise<void>;

  addChild(parentScopeId: string, childScopeId: string): Promise<ScopeChild>;
  removeChild(parentScopeId: string, childScopeId: string): Promise<void>;
  listChildScopeIds(parentScopeId: string): Promise<readonly string[]>;

  addUser(scopeId: string, userId: string): Promise<ScopeUser>;
  removeUser(scopeId: string, userId: string): Promise<void>;
  listUserIds(scopeId: string): Promise<readonly string[]>;
}

export class InvalidScopeNameError extends AiError {
  constructor() {
    super('invalid_scope_name', 'scope name must be a non-empty string');
  }
}

export class InvalidScopeDescriptionError extends AiError {
  constructor() {
    super('invalid_scope_description', 'scope description must be a non-empty string');
  }
}

export class InvalidScopeOrganizationError extends AiError {
  constructor() {
    super('invalid_scope_organization', 'scope organizationId must be a non-empty string');
  }
}

export class DuplicateScopeError extends AiError {
  constructor(organizationId: string, name: string) {
    super('duplicate_scope', `Organization ${organizationId} already has a scope named ${name}`);
  }
}

export class ScopeNotFoundError extends AiError {
  constructor(scopeId: string) {
    super('scope_not_found', `Scope not found: ${scopeId}`);
  }
}

export class SelfScopeChildError extends AiError {
  constructor(scopeId: string) {
    super('self_scope_child', `Scope ${scopeId} cannot be its own child`);
  }
}

export class ScopeOrganizationMismatchError extends AiError {
  constructor(parentScopeId: string, childScopeId: string) {
    super(
      'scope_organization_mismatch',
      `Scopes ${parentScopeId} and ${childScopeId} belong to different organizations and cannot be linked`,
    );
  }
}

export class DuplicateScopeChildError extends AiError {
  constructor(parentScopeId: string, childScopeId: string) {
    super('duplicate_scope_child', `Scope ${childScopeId} is already a child of ${parentScopeId}`);
  }
}

export class ScopeChildNotFoundError extends AiError {
  constructor(parentScopeId: string, childScopeId: string) {
    super('scope_child_not_found', `Scope ${childScopeId} is not a child of ${parentScopeId}`);
  }
}

export class InvalidScopeUserError extends AiError {
  constructor() {
    super('invalid_scope_user', 'userId must be a non-empty string');
  }
}

export class DuplicateScopeUserError extends AiError {
  constructor(scopeId: string, userId: string) {
    super('duplicate_scope_user', `User ${userId} is already part of scope ${scopeId}`);
  }
}

export class ScopeUserNotFoundError extends AiError {
  constructor(scopeId: string, userId: string) {
    super('scope_user_not_found', `User ${userId} is not part of scope ${scopeId}`);
  }
}

/** Narrow structural slice of an arangojs `Database` — fakeable in tests. */
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

/** The slice used by idempotent collection/index setup. */
export interface ScopesSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
