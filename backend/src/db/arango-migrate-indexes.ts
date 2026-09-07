export const LEGACY_INDEX_FIELDS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  members: [['userId']],
  superAdmins: [['userId'], ['memberId']],
  authChallenges: [['userId', 'kind']],
  // Visitors are anonymous now; identity and retired platform indexes go
  // with the fields scrubbed by the migration.
  visitors: [['emailHash'], ['userId'], ['platformId']],
  users: [['platformId'], ['platform_role']],
  visitorSessions: [['platformId', 'connectedAt']],
  userSessions: [['platformId', 'connectedAt']],
  folders: [['parentFolderKey'], ['scopeKey', 'managedPurpose', 'managedOwnerKey']],
  documents: [['folderKey'], ['scopeKey', 'managedPurpose', 'managedOwnerKey']],
  documentVersions: [['scopeKey'], ['documentKey'], ['storageKey']],
  contentSearchQueries: [['actorKey', 'scopeKey', 'normalizedQuery'], ['actorKey', 'scopeKey', 'contextDomain', 'normalizedQuery', 'folderKey', 'includeDescendants'], ['actorKey', 'scopeKey', 'contextDomain', 'searchedAt'], ['expiresAt']],
  events: [['distinctId', 'createdAt'], ['domain', 'createdAt']],
  places: [['scopeKey', 'isWishlist'], ['scopeKey', 'isFavorite'], ['scopeKey', 'countryCode', 'name']],
};

export const LEGACY_REMOVAL_MARKER = ['deleted', 'At'].join('');

export function isLegacyIndex(collectionName: string, fields: readonly string[], desiredIndexes: readonly (readonly string[])[] = []): boolean {
  if (desiredIndexes.some((desired) => desired.length === fields.length && desired.every((field, index) => fields[index] === field))) return false;
  if (fields.includes(LEGACY_REMOVAL_MARKER)) return true;
  return (LEGACY_INDEX_FIELDS[collectionName] ?? []).some(
    (legacy) => legacy.length === fields.length && legacy.every((field, index) => fields[index] === field),
  );
}
