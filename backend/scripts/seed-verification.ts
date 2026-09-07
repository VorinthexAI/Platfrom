import { db } from '@/lib/db/client';

export function enforceRootTeamMfa(document: Record<string, unknown>): Record<string, unknown> {
  if (document.is_root === true) document.mfa_enabled = true;
  return document;
}

export interface SeedVerificationDataSource {
  listActiveRootMemberUserKeys(seededUserKeys: readonly string[]): Promise<string[]>;
  markUsersVerified(userKeys: readonly string[], updatedAt: string): Promise<void>;
}

const defaultDataSource: SeedVerificationDataSource = {
  async listActiveRootMemberUserKeys(seededUserKeys) {
    const cursor = await db.query<string>(`
      FOR membership IN userTeams
        FILTER membership.userId IN @seededUserKeys && membership.status == "active"
        LET team = DOCUMENT(teams, membership.teamKey)
        FILTER team != null && team.is_root == true
        RETURN DISTINCT membership.userId
    `, { seededUserKeys });
    return cursor.all();
  },
  async markUsersVerified(userKeys, updatedAt) {
    await db.query(`
      FOR user IN users
        FILTER user._key IN @userKeys && user.isVerified != true
        UPDATE user WITH { isVerified: true, updatedAt: @updatedAt } IN users
    `, { userKeys, updatedAt });
  },
};

/** Verify only users named by this seed run who finish with active root membership. */
export async function ensureSeededActiveRootMembersVerified(
  seededUserKeys: readonly string[],
  updatedAt: string,
  source: SeedVerificationDataSource = defaultDataSource,
): Promise<string[]> {
  if (seededUserKeys.length === 0) return [];
  const rootMemberKeys = await source.listActiveRootMemberUserKeys([...new Set(seededUserKeys)]);
  if (rootMemberKeys.length > 0) await source.markUsersVerified(rootMemberKeys, updatedAt);
  return rootMemberKeys;
}
