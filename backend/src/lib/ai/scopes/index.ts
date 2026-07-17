export {
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  NEXUS_SCOPE_KEY,
  scopeSchema,
  scopeScopeSchema,
  scopeMemberSchema,
  scopeMemberRoleSchema,
  scopeSlugSchema,
  scopesEmbedKeys,
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
  ScopeRelationNotFoundError,
  type CreateScopeInput,
  type ScopeRepository,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';
export { createScopeRepository, getDefaultScopeRepository } from './repository';
export { createScopeMemberRepository, getDefaultScopeMemberRepository, listScopeMembersWithActiveMemberships } from './members';
export {
  DuplicateScopeMemberError,
  ScopeMemberNotFoundError,
  ScopeMemberOrganizationMismatchError,
  ScopeMembershipNotFoundError,
  type ScopeMemberRepository,
  type ScopeMemberRepositoryHooks,
  type ScopeMemberView,
  type ScopeMemberWithMembership,
} from './members';
export { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
