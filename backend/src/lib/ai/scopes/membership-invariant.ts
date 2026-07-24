import type { Database } from 'arangojs';
import { db, withDatabaseTransaction } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import type { ScopeMemberRole } from './schema';

type QueryDatabase = {
  query<T = unknown>(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<T[]> }>;
  atomic?<T>(collections: string[], operation: (database: QueryDatabase) => Promise<T>): Promise<T>;
  beginTransaction?: (...args: any[]) => Promise<any>;
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

type InheritedGrantData = {
  memberships: Array<{ key: string; orgRole: string }>;
  scopes: Array<{ key: string; deletedAt: string | null }>;
  scopeMembers: Array<{ scopeKey: string; userOrganizationKey: string; role: ScopeMemberRole }>;
  relations: Array<{ parentKey: string; childKey: string }>;
  scopeAgents: Array<{ key: string; scopeKey: string; agentKey: string; minimumAccessRole: ScopeMemberRole }>;
  inheritedGrants: Array<{ key: string; scopeAgentKey: string; userOrganizationKey: string }>;
};

const roleRank: Record<ScopeMemberRole, number> = { owner: 4, admin: 3, moderator: 2, viewer: 1 };

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

export async function reconcileOrganizationInheritedAgentMemberships(
  organizationKey: string,
  database: QueryDatabase = db,
) {
  const cursor = await database.query<InheritedGrantData>(`
    RETURN {
      memberships: (FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey && membership.status == "active" RETURN { key: membership._key, orgRole: membership.orgRole }),
      scopes: (FOR scope IN scopes FILTER scope.organizationKey == @organizationKey RETURN { key: scope._key, deletedAt: scope.deletedAt }),
      scopeMembers: (FOR member IN scopeMembers FOR scope IN scopes FILTER scope._key == member.scopeKey && scope.organizationKey == @organizationKey && member.status == "active" RETURN { scopeKey: member.scopeKey, userOrganizationKey: member.userOrganizationKey, role: member.role }),
      relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }),
      scopeAgents: (FOR relation IN scopeAgents FILTER relation.organizationKey == @organizationKey && relation.status == "active" RETURN { key: relation._key, scopeKey: relation.scopeKey, agentKey: relation.agentKey, minimumAccessRole: relation.minimumAccessRole }),
      inheritedGrants: (FOR grant IN agentMembers FILTER grant.organizationKey == @organizationKey && grant.source == "inherited" RETURN { key: grant._key, scopeAgentKey: grant.scopeAgentKey, userOrganizationKey: grant.userOrganizationKey })
    }
  `, { organizationKey });
  const data = (await cursor.all())[0];
  if (!data) return { created: [], removed: [] };

  const scopes = new Map(data.scopes.map((scope) => [scope.key, scope]));
  const parentByChild = new Map(data.relations.map((relation) => [relation.childKey, relation.parentKey]));
  const eligible = new Set<string>();
  for (const relation of data.scopeAgents) {
    if (scopes.get(relation.scopeKey)?.deletedAt) continue;
    for (const membership of data.memberships) {
      let effectiveRole: ScopeMemberRole | null = scopeRoleForOrganizationRole(membership.orgRole);
      if (membership.orgRole !== 'owner' && membership.orgRole !== 'admin') {
        const ancestors = new Set([relation.scopeKey]);
        let parent = parentByChild.get(relation.scopeKey);
        while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
        const roles = data.scopeMembers
          .filter((member) => member.userOrganizationKey === membership.key && ancestors.has(member.scopeKey))
          .map((member) => member.role);
        effectiveRole = roles.sort((left, right) => roleRank[right] - roleRank[left])[0] ?? null;
      }
      if (effectiveRole && roleRank[effectiveRole] >= roleRank[relation.minimumAccessRole]) eligible.add(`${relation.key}:${membership.key}`);
    }
  }

  const existing = new Map(data.inheritedGrants.map((grant) => [`${grant.scopeAgentKey}:${grant.userOrganizationKey}`, grant]));
  const removed = [...existing.entries()].filter(([pair]) => !eligible.has(pair)).map(([, grant]) => grant.key);
  const now = new Date().toISOString();
  const relationsByKey = new Map(data.scopeAgents.map((relation) => [relation.key, relation]));
  const created = [...eligible].filter((pair) => !existing.has(pair)).map((pair) => {
    const separator = pair.indexOf(':');
    const scopeAgentKey = pair.slice(0, separator);
    const userOrganizationKey = pair.slice(separator + 1);
    const relation = relationsByKey.get(scopeAgentKey)!;
    return { key: newId(), organizationKey, scopeKey: relation.scopeKey, agentKey: relation.agentKey, scopeAgentKey, userOrganizationKey, source: 'inherited', createdByUserOrganizationKey: null, createdAt: now, embedding: [] };
  });
  const apply = async (transaction: QueryDatabase) => {
    if (removed.length) await transaction.query('FOR key IN @removed REMOVE key IN agentMembers', { removed });
    if (created.length) await transaction.query(`
        FOR document IN @documents
          UPSERT { scopeAgentKey: document.scopeAgentKey, userOrganizationKey: document.userOrganizationKey, source: "inherited" }
          INSERT MERGE(UNSET(document, "key"), { _key: document.key })
          UPDATE {}
          IN agentMembers
      `, { documents: created });
  };
  if (database.beginTransaction) await withDatabaseTransaction(database as Database, ['agentMembers'], (transaction) => apply(transaction));
  else if (database.atomic) await database.atomic(['agentMembers'], apply);
  else await apply(database);
  return { created, removed };
}
