import { db } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import type { ScopeMemberRole } from './schema';

type QueryDatabase = {
  query<T = unknown>(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<T[]> }>;
};

type ScopeMembershipCandidate = {
  scopeKey: string;
  userOrganizationKey: string;
  orgRole: string;
  existing: { _key: string } | null;
};

export type ScopeMembershipReconciliation = {
  created: Array<{ key: string; scopeKey: string; userOrganizationKey: string; role: ScopeMemberRole }>;
};

export function scopeRoleForOrganizationRole(orgRole: string): ScopeMemberRole {
  return orgRole === 'owner' || orgRole === 'admin' || orgRole === 'moderator' ? orgRole : 'viewer';
}

export async function reconcileOrganizationScopeMemberships(
  organizationKey: string,
  options: { scopeKeys?: readonly string[]; userOrganizationKeys?: readonly string[] } = {},
  database: QueryDatabase = db,
): Promise<ScopeMembershipReconciliation> {
  const cursor = await database.query<ScopeMembershipCandidate>(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @organizationKey
      FILTER membership.status == "active"
      FILTER @userOrganizationKeys == null || membership._key IN @userOrganizationKeys
      FOR scope IN scopes
        FILTER scope.organizationKey == @organizationKey
        FILTER @scopeKeys == null || scope._key IN @scopeKeys
        LET existing = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == scope._key && member.userOrganizationKey == membership._key LIMIT 1 RETURN KEEP(member, "_key"))
        RETURN { scopeKey: scope._key, userOrganizationKey: membership._key, orgRole: membership.orgRole, existing }
  `, {
    organizationKey,
    scopeKeys: options.scopeKeys ? [...options.scopeKeys] : null,
    userOrganizationKeys: options.userOrganizationKeys ? [...options.userOrganizationKeys] : null,
  });
  const candidates = await cursor.all();
  const documents = candidates.map((row) => ({
    key: newId(),
    scopeKey: row.scopeKey,
    userOrganizationKey: row.userOrganizationKey,
    role: scopeRoleForOrganizationRole(row.orgRole),
  }));
  const created = documents.filter((_, index) => !candidates[index]!.existing);
  if (documents.length) {
    await database.query(`
      FOR document IN @documents
        UPSERT { scopeKey: document.scopeKey, userOrganizationKey: document.userOrganizationKey }
        INSERT {
          _key: document.key,
          scopeKey: document.scopeKey,
          userOrganizationKey: document.userOrganizationKey,
           role: document.role,
          status: "active",
          source: "organization"
        }
        UPDATE {}
        IN scopeMembers
    `, { documents });
    await database.query(`
      FOR document IN @documents
        FOR member IN scopeMembers
          FILTER member.scopeKey == document.scopeKey
          FILTER member.userOrganizationKey == document.userOrganizationKey
          FILTER member.source == "organization"
          UPDATE member WITH { role: document.role, status: "active" }
          IN scopeMembers
    `, { documents });
  }
  return { created };
}
