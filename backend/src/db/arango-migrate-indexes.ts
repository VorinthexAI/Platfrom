export const LEGACY_INDEX_FIELDS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  members: [['userId']],
  superAdmins: [['userId'], ['memberId']],
  authChallenges: [['userId', 'kind']],
  // Visitors are anonymous now; identity and retired platform indexes go
  // with the fields scrubbed by the migration.
  visitors: [['emailHash'], ['userId'], ['platformId']],
  users: [['platformId'], ['platform_role'], ['organization_role']],
  visitorSessions: [['platformId', 'connectedAt']],
  userSessions: [['platformId', 'connectedAt']],
  agents: [['orchestratorId'], ['orchestratorId', 'name'], ['enabled']],
  skills: [['enabled']],
  scopes: [['organizationId', 'name'], ['organizationId']],
  // Agents may be assigned to multiple scopes. The current unique identity
  // is (scopeKey, agentKey), not agentKey by itself.
  scopeAgents: [['agentKey']],
  organizations: [['ownerId']],
  events: [['belongsTo', 'sourceId', 'createdAt']],
  folders: [['parentFolderKey']],
  documents: [['folderKey']],
  documentVersions: [['scopeKey'], ['documentKey'], ['storageKey']],
  documentShares: [['scopeKey'], ['token']],
};

export const DOCUMENT_SHARE_COMMENT_LEGACY_PERMISSIONS = ['comment', 'edit'] as const;

export function normalizeLegacyDocumentSharePermission(permission: unknown): 'read' | 'comment' {
  return DOCUMENT_SHARE_COMMENT_LEGACY_PERMISSIONS.includes(permission as 'comment' | 'edit') ? 'comment' : 'read';
}

export function isLegacyIndex(collectionName: string, fields: readonly string[], desiredIndexes: readonly (readonly string[])[] = []): boolean {
  if (desiredIndexes.some((desired) => desired.length === fields.length && desired.every((field, index) => fields[index] === field))) return false;
  return (LEGACY_INDEX_FIELDS[collectionName] ?? []).some(
    (legacy) => legacy.length === fields.length && legacy.every((field, index) => fields[index] === field),
  );
}
