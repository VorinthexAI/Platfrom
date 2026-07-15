export {
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeSchema,
  scopeScopeSchema,
  scopeMemberSchema,
  scopeMemberRoleSchema,
  scopeSlugSchema,
  SCOPE_MEMBER_ROLES,
  type Scope,
  type ScopeMember,
  type ScopeMemberRole,
  type ScopeScope,
} from './schema';
export {
  DuplicateScopeRelationError,
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopePositionConflictError,
  ScopeRelationNotFoundError,
  type CreateScopeInput,
  type ScopeRepository,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';
export { createScopeRepository, getDefaultScopeRepository } from './repository';
export { createScopeMemberRepository, getDefaultScopeMemberRepository } from './members';
export {
  DuplicateScopeMemberError,
  ScopeMemberNotFoundError,
  ScopeMemberOrganizationMismatchError,
  ScopeMembershipNotFoundError,
  type ScopeMemberRepository,
  type ScopeMemberView,
} from './members';
export { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
