import { db } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import type { ScopeMemberRole } from './schema';

type QueryDatabase = {
  query<T = unknown>(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<T[]> }>;
};

type ScopeMembershipCandidate = {
  scopeKey: string;
  userTeamKey: string;
  teamRole: string;
  existing: { _key: string } | null;
};

export type ScopeMembershipReconciliation = {
  created: Array<{ key: string; scopeKey: string; userTeamKey: string; role: ScopeMemberRole }>;
};

export function scopeRoleForTeamRole(teamRole: string): ScopeMemberRole {
  return teamRole === 'owner' || teamRole === 'admin' || teamRole === 'moderator' ? teamRole : 'viewer';
}

export async function reconcileTeamScopeMemberships(
  teamKey: string,
  options: { scopeKeys?: readonly string[]; userTeamKeys?: readonly string[] } = {},
  database: QueryDatabase = db,
): Promise<ScopeMembershipReconciliation> {
  const cursor = await database.query<ScopeMembershipCandidate>(`
    FOR membership IN userTeams
      FILTER membership.teamKey == @teamKey
      FILTER membership.status == "active"
      FILTER @userTeamKeys == null || membership._key IN @userTeamKeys
      FOR scope IN scopes
        FILTER scope.teamKey == @teamKey
        FILTER @scopeKeys == null || scope._key IN @scopeKeys
        LET existing = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == scope._key && member.userTeamKey == membership._key LIMIT 1 RETURN KEEP(member, "_key"))
        RETURN { scopeKey: scope._key, userTeamKey: membership._key, teamRole: membership.teamRole, existing }
  `, {
    teamKey,
    scopeKeys: options.scopeKeys ? [...options.scopeKeys] : null,
    userTeamKeys: options.userTeamKeys ? [...options.userTeamKeys] : null,
  });
  const candidates = await cursor.all();
  const documents = candidates.map((row) => ({
    key: newId(),
    scopeKey: row.scopeKey,
    userTeamKey: row.userTeamKey,
    role: scopeRoleForTeamRole(row.teamRole),
  }));
  const created = documents.filter((_, index) => !candidates[index]!.existing);
  if (documents.length) {
    await database.query(`
      FOR document IN @documents
        UPSERT { scopeKey: document.scopeKey, userTeamKey: document.userTeamKey }
        INSERT {
          _key: document.key,
          scopeKey: document.scopeKey,
          userTeamKey: document.userTeamKey,
           role: document.role,
          status: "active",
          source: "team"
        }
        UPDATE {}
        IN scopeMembers
    `, { documents });
    await database.query(`
      FOR document IN @documents
        FOR member IN scopeMembers
          FILTER member.scopeKey == document.scopeKey
          FILTER member.userTeamKey == document.userTeamKey
          FILTER member.source == "team"
          UPDATE member WITH { role: document.role, status: "active" }
          IN scopeMembers
    `, { documents });
  }
  return { created };
}
