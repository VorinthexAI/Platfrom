export {
  SCOPE_CHILDREN_COLLECTION,
  SCOPE_USERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeChildKey,
  scopeChildSchema,
  scopeSchema,
  scopeUserKey,
  scopeUserSchema,
  type Scope,
  type ScopeChild,
  type ScopeUser,
} from './schema';
export {
  DuplicateScopeChildError,
  DuplicateScopeError,
  DuplicateScopeUserError,
  InvalidScopeDescriptionError,
  InvalidScopeNameError,
  InvalidScopeOrganizationError,
  InvalidScopeUserError,
  ScopeChildNotFoundError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopeUserNotFoundError,
  SelfScopeChildError,
  type CreateScopeInput,
  type ScopeRepository,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';
export { createScopeRepository, getDefaultScopeRepository } from './repository';
export { ensureScopeChildrenCollection, ensureScopesCollection, ensureScopeUsersCollection } from './indexes';
