import { db, withTransaction } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from './domain-execute';
import { evaluateScopeAccess, rankAccessRole, type MembershipRecord, type ScopeAgentRecord } from './domain-access-engine';

async function allOrganizationMembers(organizationKey: string): Promise<MembershipRecord[]> {
  const cursor = await db.query<MembershipRecord>(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @organizationKey
      FOR user IN users FILTER user._key == membership.userId
      RETURN { key: membership._key, organizationId: membership.organizationId, userId: membership.userId, orgRole: membership.orgRole, status: membership.status, user: { key: user._key, name: user.name, email: user.email, alias: user.alias } }
  `, { organizationKey });
  return cursor.all();
}

async function inheritedGrantPlan(context: DomainToolContext, relation: ScopeAgentRecord) {
  const members = await allOrganizationMembers(context.organizationKey);
  const eligible = new Set<string>();
  for (const member of members) {
    if (member.status !== 'active') continue;
    const decision = await evaluateScopeAccess(context, { scope: relation.scopeKey, member: member.key, action: 'read' });
    if (decision.allowed && rankAccessRole(decision.effectiveRole) >= rankAccessRole(relation.minimumAccessRole)) eligible.add(member.key);
  }
  const cursor = await db.query<{ key: string; userOrganizationKey: string }>('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @scopeAgentKey && grant.source == "inherited" RETURN { key: grant._key, userOrganizationKey: grant.userOrganizationKey }', { scopeAgentKey: relation.key });
  const existing = await cursor.all();
  return {
    create: [...eligible].filter((key) => !existing.some((grant) => grant.userOrganizationKey === key)),
    remove: existing.filter((grant) => !eligible.has(grant.userOrganizationKey)),
    unchanged: existing.filter((grant) => eligible.has(grant.userOrganizationKey)).map((grant) => grant.userOrganizationKey),
  };
}

async function applyInheritedGrantPlan(context: DomainToolContext, relation: ScopeAgentRecord) {
  const plan = await inheritedGrantPlan(context, relation);
  const createdAt = new Date().toISOString();
  const documents = plan.create.map((userOrganizationKey) => ({ _key: newId(), organizationKey: context.organizationKey, scopeKey: relation.scopeKey, agentKey: relation.agentKey, scopeAgentKey: relation.key, userOrganizationKey, source: 'inherited', createdByUserOrganizationKey: null, createdAt, embedding: [] }));
  await withTransaction(['agentMembers'], async (trx) => {
    if (plan.remove.length) await trx.query('FOR grant IN agentMembers FILTER grant._key IN @keys REMOVE grant IN agentMembers', { keys: plan.remove.map((grant) => grant.key) });
    if (documents.length) await trx.query('FOR document IN @documents INSERT document INTO agentMembers', { documents });
  });
  return { create: plan.create, remove: plan.remove.map((grant) => grant.userOrganizationKey), unchanged: plan.unchanged };
}

/** Internal reconciliation used when organization or scope membership changes. */
export async function syncOrganizationAgentMembers(context: DomainToolContext) {
  const cursor = await db.query<ScopeAgentRecord>('FOR relation IN scopeAgents FILTER relation.organizationKey == @organizationKey && relation.status == "active" RETURN MERGE(relation, { key: relation._key })', { organizationKey: context.organizationKey });
  return Promise.all((await cursor.all()).map((relation) => applyInheritedGrantPlan(context, relation)));
}
