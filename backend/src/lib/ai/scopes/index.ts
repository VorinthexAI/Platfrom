export {
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  MOTHER_SCOPE_KEY,
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
  ScopeTeamMismatchError,
  ProductScopeMutationError,
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
  ScopeMemberTeamMismatchError,
  ScopeMembershipNotFoundError,
  type ScopeMemberRepository,
  type ScopeMemberView,
} from './members';
export { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
export { createScopeService, resolveScopeManagementContext, scopeCreateInputSchema, scopeListInputSchema, scopeSelectInputSchema, scopeService, ScopeServiceError, type PublicScope, type ScopeService } from './service';
