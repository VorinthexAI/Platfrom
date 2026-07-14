export { ORGANIZATION_SCOPES_COLLECTION, organizationScopeSchema, type OrganizationScope } from './schema';
export {
  InvalidScopeNameError,
  DuplicateOrganizationScopeError,
  OrganizationScopeNotFoundError,
  type OrganizationScopeRepository,
  type OrganizationScopesDatabase,
  type OrganizationScopesSetupDatabase,
} from './types';
export { createOrganizationScopeRepository, getDefaultOrganizationScopeRepository } from './repository';
export { ensureOrganizationScopesCollection } from './indexes';
