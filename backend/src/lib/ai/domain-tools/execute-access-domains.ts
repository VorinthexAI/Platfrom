import { db, withTransaction } from '@/lib/db/client';
import { insertEvent } from '@/lib/db/events.node';
import { newId } from '@/lib/ids';
import { providerSlugSchema } from '@/lib/ai/providers';
import type { DomainActionSlug, DomainToolResult } from './schemas';
import { domainToolResultSchema } from './schemas';
import type { DomainToolContext } from './execute';
import { DomainToolExecutionError } from './execute';
import {
  accessRoleRank,
  evaluateAgentAccess,
  evaluateOrganizationAccess,
  evaluateScopeAccess,
  explainAgentDecision,
  explainOrganizationDecision,
  explainScopeDecision,
  getActiveOrganization,
  getScopeAgent,
  rankAccessRole,
  resolveAgentInOrganization,
  resolveMembership,
  resolveScope,
  type AccessRole,
  type AgentRecord,
  type MembershipRecord,
  type ScopeAgentRecord,
} from './access-engine';

type Input = Record<string, any>;
const sensitiveAgent = (agent: AgentRecord) => ['genesis', 'beacon'].includes(agent.slug) || agent.slug.startsWith('system-');

function human(context: DomainToolContext) {
  if (context.principal.kind !== 'member') throw new DomainToolExecutionError('human_principal_required', 'A human organization member must initiate this operation');
  return context.principal;
}

function output(action: DomainActionSlug, data: unknown, status: 'completed' | 'preview' = 'completed'): DomainToolResult {
  return domainToolResultSchema.parse({ action, status, data });
}

async function audit(context: DomainToolContext, action: DomainActionSlug, data: Record<string, unknown>) {
  const principal = human(context);
  await insertEvent({ key: newId(), scopeId: context.runtimeScopeKey, userId: principal.user.key, slug: action, data, createdAt: new Date().toISOString() });
}

async function requireScopeManager(context: DomainToolContext, scope: string) {
  const decision = await evaluateScopeAccess(context, { scope, action: 'scope.agent.manage' });
  if (!decision.allowed || rankAccessRole(decision.effectiveRole) < accessRoleRank.admin) throw new DomainToolExecutionError('scope_forbidden', 'Owner or admin scope access is required');
  return decision;
}

async function relationMatches(scopeKey: string, references: string[]) {
  const cursor = await db.query<{ relation: ScopeAgentRecord; agent: AgentRecord }>(`
    FOR relation IN scopeAgents
      FILTER relation.scopeKey == @scopeKey
      FOR agent IN agents FILTER agent._key == relation.agentKey
      RETURN { relation: MERGE(relation, { key: relation._key }), agent: MERGE(agent, { key: agent._key }) }
  `, { scopeKey });
  const rows = await cursor.all();
  return references.map((reference) => {
    const needle = reference.toLocaleLowerCase();
    const matches = rows.filter(({ relation, agent }) => relation.key === reference || agent.key === reference || agent.slug.toLocaleLowerCase() === needle || agent.name.toLocaleLowerCase() === needle);
    return { input: reference, matches };
  });
}

async function uniqueRelation(scopeKey: string, reference: string) {
  const resolved = (await relationMatches(scopeKey, [reference]))[0]!;
  if (resolved.matches.length !== 1) throw new DomainToolExecutionError(resolved.matches.length ? 'agent_ambiguous' : 'agent_not_found', `${reference} resolved to ${resolved.matches.length} scope agents`);
  return resolved.matches[0]!;
}

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
  const existingKeys = new Set(existing.map((grant) => grant.userOrganizationKey));
  return {
    create: [...eligible].filter((key) => !existingKeys.has(key)),
    remove: existing.filter((grant) => !eligible.has(grant.userOrganizationKey)),
    unchanged: existing.filter((grant) => eligible.has(grant.userOrganizationKey)).map((grant) => grant.userOrganizationKey),
  };
}

async function applyInheritedGrantPlan(context: DomainToolContext, relation: ScopeAgentRecord, dryRun = false) {
  const plan = await inheritedGrantPlan(context, relation);
  if (!dryRun) {
    const createdAt = new Date().toISOString();
    const documents = plan.create.map((userOrganizationKey) => ({ _key: newId(), organizationKey: context.organizationKey, scopeKey: relation.scopeKey, agentKey: relation.agentKey, scopeAgentKey: relation.key, userOrganizationKey, source: 'inherited', createdByUserOrganizationKey: null, createdAt, embedding: [] }));
    await withTransaction(['agentMembers'], async (trx) => {
      if (plan.remove.length) await trx.query('FOR grant IN agentMembers FILTER grant._key IN @keys REMOVE grant IN agentMembers', { keys: plan.remove.map((grant) => grant.key) });
      if (documents.length) await trx.query('FOR document IN @documents INSERT document INTO agentMembers', { documents });
    });
  }
  return { create: plan.create, remove: plan.remove.map((grant) => grant.userOrganizationKey), unchanged: plan.unchanged, dryRun };
}

export async function syncOrganizationAgentMembers(context: DomainToolContext) {
  const cursor = await db.query<ScopeAgentRecord>('FOR relation IN scopeAgents FILTER relation.organizationKey == @organizationKey && relation.status == "active" RETURN MERGE(relation, { key: relation._key })', { organizationKey: context.organizationKey });
  const relations = await cursor.all();
  return Promise.all(relations.map((relation) => applyInheritedGrantPlan(context, relation)));
}

function page<T>(items: T[], input: Input) {
  const offset = input.cursor ? Number.parseInt(Buffer.from(input.cursor, 'base64url').toString(), 10) || 0 : 0;
  const limit = input.limit ?? 50;
  return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64url') : null };
}

async function executeScopeAgent(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  if (action === 'scope.agent.list') {
    const access = await evaluateScopeAccess(context, { scope: input.scope, action: 'read' });
    if (!access.allowed) throw new DomainToolExecutionError('scope_forbidden', access.reason);
    const cursor = await db.query<any>(`
      FOR relation IN scopeAgents FILTER relation.scopeKey == @scopeKey && relation.status == @status
        FOR agent IN agents FILTER agent._key == relation.agentKey
        LET memberCount = LENGTH(FOR grant IN agentMembers FILTER grant.scopeAgentKey == relation._key RETURN 1)
        RETURN { scopeAgentKey: relation._key, scopeKey: relation.scopeKey, agentKey: agent._key, name: agent.name, title: agent.title, slug: agent.slug, position: relation.position, status: relation.status, minimumAccessRole: relation.minimumAccessRole, memberCount, createdAt: relation.createdAt }
    `, { scopeKey: access.scope.key, status: input.status });
    let agents = await cursor.all();
    if (rankAccessRole(access.effectiveRole) < accessRoleRank.admin) agents = agents.filter((agent: any) => !sensitiveAgent({ key: agent.agentKey, ...agent, scopeKey: access.scope.key }));
    if (input.query) agents = agents.filter((agent: any) => `${agent.name} ${agent.title} ${agent.slug}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()));
    if (input.minimumAccessRole) agents = agents.filter((agent: any) => agent.minimumAccessRole === input.minimumAccessRole);
    agents.sort((a: any, b: any) => input.sort === 'name' ? a.name.localeCompare(b.name) : input.sort === 'createdAt' ? a.createdAt.localeCompare(b.createdAt) : a.position - b.position || a.name.localeCompare(b.name));
    const result = page(agents, input); return output(action, { agents: result.items, nextCursor: result.nextCursor });
  }

  const scope = await resolveScope(context, input.scope ?? input.fromScope);
  if (action === 'scope.agent.read') {
    const access = await evaluateScopeAccess(context, { scope: scope.key, action: 'read' });
    if (!access.allowed) throw new DomainToolExecutionError('scope_forbidden', access.reason);
    const matches = await relationMatches(scope.key, input.agents);
    const detailedMatches = await Promise.all(matches.map(async ({ input: reference, matches: candidates }) => {
      const visible = candidates.filter(({ agent }) => rankAccessRole(access.effectiveRole) >= accessRoleRank.admin || !sensitiveAgent(agent));
      const details = await Promise.all(visible.map(async ({ relation, agent }) => {
        const grants = await db.query<{ source: string; count: number }>('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @key COLLECT source = grant.source WITH COUNT INTO count RETURN { source, count }', { key: relation.key });
        const counts = Object.fromEntries((await grants.all()).map((item) => [item.source, item.count]));
        const self = await evaluateAgentAccess(context, { scope: scope.key, agent: agent.key, action: 'run' });
        return { ...relation, agent, inheritedMemberCount: counts.inherited ?? 0, explicitMemberCount: counts.explicit ?? 0, currentUserAllowed: self.allowed, currentUserAccessSources: self.agentAccessSources };
      }));
      return { input: reference, matches: details };
    }));
    return output(action, { matches: detailedMatches });
  }

  if (action === 'scope.agent.add') {
    const access = await requireScopeManager(context, scope.key);
    const agent = await resolveAgentInOrganization(context, input.agent);
    if (scope.deletedAt) throw new DomainToolExecutionError('scope_archived', 'Archived scopes cannot receive agents');
    if (sensitiveAgent(agent) && access.effectiveRole !== 'owner') throw new DomainToolExecutionError('system_agent_policy_denied', 'Only a scope owner may link a sensitive system agent');
    if (await getScopeAgent(scope.key, agent.key)) throw new DomainToolExecutionError('scope_agent_duplicate', 'The agent is already linked to this scope');
    const timestamp = new Date().toISOString(); const relation: ScopeAgentRecord = { key: newId(), organizationKey: context.organizationKey, scopeKey: scope.key, agentKey: agent.key, position: input.position, status: 'active', minimumAccessRole: access.effectiveRole!, createdByUserOrganizationKey: human(context).userOrganization.key, createdAt: timestamp, updatedAt: timestamp };
    await withTransaction(['scopeAgents'], async (trx) => { await trx.query('INSERT MERGE(@relation, { _key: @key, embedding: [] }) INTO scopeAgents', { relation: { ...relation, key: undefined }, key: relation.key }); });
    const sync = await applyInheritedGrantPlan(context, relation); await audit(context, action, { scopeAgentKey: relation.key }); return output(action, { relation, sync });
  }

  if (action === 'scope.agent.move') {
    const sourceAccess = await requireScopeManager(context, scope.key);
    const current = await uniqueRelation(scope.key, input.agent);
    if (sensitiveAgent(current.agent) && sourceAccess.effectiveRole !== 'owner') throw new DomainToolExecutionError('system_agent_policy_denied', 'Only a scope owner may move a sensitive system agent');
    if (input.scope) {
      await withTransaction(['scopeAgents'], async (trx) => { await trx.query('UPDATE @key WITH { position: @position, updatedAt: @updatedAt } IN scopeAgents', { key: current.relation.key, position: input.position, updatedAt: new Date().toISOString() }); });
      await audit(context, action, { scopeAgentKey: current.relation.key }); return output(action, { scopeAgentKey: current.relation.key, scopeKey: scope.key, position: input.position });
    }
    const destination = await resolveScope(context, input.toScope);
    const destinationAccess = await requireScopeManager(context, destination.key);
    if (sensitiveAgent(current.agent) && destinationAccess.effectiveRole !== 'owner') throw new DomainToolExecutionError('system_agent_policy_denied', 'Destination owner access is required for a sensitive system agent');
    if (destination.deletedAt) throw new DomainToolExecutionError('scope_archived', 'Destination scope is archived');
    if (await getScopeAgent(destination.key, current.agent.key)) throw new DomainToolExecutionError('scope_agent_duplicate', 'The destination already contains this agent');
    const moved = { ...current.relation, scopeKey: destination.key, position: input.position ?? current.relation.position, updatedAt: new Date().toISOString() };
    await withTransaction(['scopeAgents', 'agentMembers'], async (trx) => { await trx.query('UPDATE @key WITH { scopeKey: @scopeKey, position: @position, minimumAccessRole: @minimumAccessRole, updatedAt: @updatedAt } IN scopeAgents', { key: moved.key, scopeKey: moved.scopeKey, position: moved.position, minimumAccessRole: moved.minimumAccessRole, updatedAt: moved.updatedAt }); await trx.query('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @key UPDATE grant WITH { scopeKey: @scopeKey } IN agentMembers', { key: moved.key, scopeKey: moved.scopeKey }); });
    const sync = await applyInheritedGrantPlan(context, moved); await audit(context, action, { scopeAgentKey: moved.key, fromScopeKey: scope.key, toScopeKey: destination.key }); return output(action, { relation: moved, sync });
  }

  const managerAccess = await requireScopeManager(context, scope.key);
  const references = action.includes('access-threshold') ? [input.agent] : input.agents;
  const relations = await Promise.all(references.map((reference: string) => uniqueRelation(scope.key, reference)));
  if (relations.some(({ agent }) => sensitiveAgent(agent)) && managerAccess.effectiveRole !== 'owner' && (action === 'scope.agent.archive' || action === 'scope.agent.remove' || action === 'scope.agent.access-threshold.update')) throw new DomainToolExecutionError('system_agent_policy_denied', 'Only a scope owner may change a sensitive system-agent relation');
  if (action === 'scope.agent.archive') {
    const timestamp = new Date().toISOString(); const keys = relations.map(({ relation }) => relation.key);
    await withTransaction(['scopeAgents'], async (trx) => { await trx.query('FOR relation IN scopeAgents FILTER relation._key IN @keys UPDATE relation WITH { status: "archived", updatedAt: @timestamp } IN scopeAgents', { keys, timestamp }); });
    await audit(context, action, { scopeAgentKeys: keys }); return output(action, { scopeAgentKeys: keys, status: 'archived', runtimeBlocked: true, schedulesResumed: false });
  }
  if (action === 'scope.agent.restore') {
    if (scope.deletedAt) throw new DomainToolExecutionError('scope_archived', 'Restore the scope before restoring agent relations');
    const timestamp = new Date().toISOString(); const keys = relations.map(({ relation }) => relation.key);
    await withTransaction(['scopeAgents'], async (trx) => { await trx.query('FOR relation IN scopeAgents FILTER relation._key IN @keys UPDATE relation WITH { status: "active", updatedAt: @timestamp } IN scopeAgents', { keys, timestamp }); });
    const sync = await Promise.all(relations.map(({ relation }) => applyInheritedGrantPlan(context, { ...relation, status: 'active', updatedAt: timestamp })));
    await audit(context, action, { scopeAgentKeys: keys }); return output(action, { scopeAgentKeys: keys, sync, schedulesResumed: false });
  }
  if (action === 'scope.agent.remove') {
    if (relations.some(({ relation }) => relation.status !== 'archived')) throw new DomainToolExecutionError('scope_agent_active', 'Archive every relation before removal');
    const keys = relations.map(({ relation }) => relation.key);
    const activeRuns = await db.query('FOR run IN agentRuns FILTER run.scopeKey == @scopeKey && run.agentKey IN @agentKeys && run.status == "accepted" LIMIT 1 RETURN run._key', { scopeKey: scope.key, agentKeys: relations.map(({ agent }) => agent.key) });
    if (await activeRuns.next()) throw new DomainToolExecutionError('agent_run_active', 'An active run blocks relation removal');
    await withTransaction(['scopeAgents', 'agentMembers'], async (trx) => { await trx.query('FOR grant IN agentMembers FILTER grant.scopeAgentKey IN @keys REMOVE grant IN agentMembers', { keys }); await trx.query('FOR relation IN scopeAgents FILTER relation._key IN @keys REMOVE relation IN scopeAgents', { keys }); });
    await audit(context, action, { scopeAgentKeys: keys }); return output(action, { scopeAgentKeys: keys, agentDefinitionsRemoved: false });
  }
  const relation = relations[0]!.relation; const actorRole = (await evaluateScopeAccess(context, { scope: scope.key, action: 'scope.agent.manage' })).effectiveRole!;
  if (sensitiveAgent(relations[0]!.agent) && input.minimumAccessRole !== 'owner') throw new DomainToolExecutionError('system_agent_policy_denied', 'Sensitive system agents require owner access');
  if (rankAccessRole(input.minimumAccessRole) < rankAccessRole(actorRole) && actorRole !== 'owner') throw new DomainToolExecutionError('threshold_escalation', 'Only an owner may lower the threshold below the actor role');
  const updated = { ...relation, minimumAccessRole: input.minimumAccessRole, updatedAt: new Date().toISOString() };
  await withTransaction(['scopeAgents'], async (trx) => { await trx.query('UPDATE @key WITH { minimumAccessRole: @role, updatedAt: @updatedAt } IN scopeAgents', { key: relation.key, role: input.minimumAccessRole, updatedAt: updated.updatedAt }); });
  const sync = await applyInheritedGrantPlan(context, updated); await audit(context, action, { scopeAgentKey: relation.key, minimumAccessRole: input.minimumAccessRole }); return output(action, { relation: updated, sync });
}

async function executeAgentMember(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  const access = await requireScopeManager(context, input.scope);
  const resolved = await uniqueRelation(access.scope.key, input.agent);
  const relation = resolved.relation;
  if (action === 'agent.member.sync') {
    const sync = await applyInheritedGrantPlan(context, relation, input.dryRun); if (!input.dryRun) await audit(context, action, { scopeAgentKey: relation.key }); return output(action, sync);
  }
  const members = await allOrganizationMembers(context.organizationKey);
  if (action === 'agent.member.list') {
    const grantCursor = await db.query<{ userOrganizationKey: string; source: 'inherited' | 'explicit' }>('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @key RETURN { userOrganizationKey: grant.userOrganizationKey, source: grant.source }', { key: relation.key });
    const grants = await grantCursor.all();
    const rows = [];
    for (const member of members) {
      const memberGrants = grants.filter((grant) => grant.userOrganizationKey === member.key);
      if (!memberGrants.length || input.source && !memberGrants.some((grant) => grant.source === input.source)) continue;
      if (input.query && !`${member.user.name ?? ''} ${member.user.email} ${member.user.alias ?? ''}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) continue;
      const scopeDecision = await evaluateScopeAccess(context, { scope: access.scope.key, member: member.key, action: 'read' });
      rows.push({ userOrganizationKey: member.key, name: member.user.name, alias: member.user.alias, email: member.user.email, effectiveScopeRole: scopeDecision.effectiveRole, inherited: memberGrants.some((grant) => grant.source === 'inherited'), explicit: memberGrants.some((grant) => grant.source === 'explicit'), effectiveAccess: member.status === 'active' && scopeDecision.allowed && relation.status === 'active', membershipStatus: member.status });
    }
    const result = page(rows, input); return output(action, { members: result.items, nextCursor: result.nextCursor });
  }
  const targets = await Promise.all(input.members.map(async (reference: string) => { const member = await resolveMembership(context, reference); if (!member) throw new DomainToolExecutionError('member_not_found', `${reference} was not found`); return member; }));
  if (action === 'agent.member.read') return output(action, { members: await Promise.all(targets.map(async (member) => {
    const decision = await evaluateAgentAccess(context, { scope: access.scope.key, agent: resolved.agent.key, member: member.key, action: 'run' });
    return { userOrganizationKey: member.key, name: member.user.name, organizationMembershipStatus: member.status, effectiveScopeRole: decision.effectiveScopeRole, grants: { inherited: decision.agentAccessSources.includes('inherited'), explicit: decision.agentAccessSources.includes('explicit') }, scopeAgentKey: relation.key, effectiveAccess: decision.allowed, denyReason: decision.allowed ? null : decision.reason };
  })) });
  if (action === 'agent.member.grant') {
    if (relation.status !== 'active') throw new DomainToolExecutionError('scope_agent_archived', 'Explicit grants require an active scope-agent relation');
    const documents: Array<Record<string, unknown>> = [];
    for (const member of targets) {
      if (member.status !== 'active') throw new DomainToolExecutionError('membership_suspended', `${member.user.email} is not active`);
      const scopeDecision = await evaluateScopeAccess(context, { scope: access.scope.key, member: member.key, action: 'read' });
      if (!scopeDecision.allowed) throw new DomainToolExecutionError('scope_access_required', `${member.user.email} lacks scope access`);
      documents.push({ _key: newId(), organizationKey: context.organizationKey, scopeKey: access.scope.key, agentKey: resolved.agent.key, scopeAgentKey: relation.key, userOrganizationKey: member.key, source: 'explicit', createdByUserOrganizationKey: human(context).userOrganization.key, createdAt: new Date().toISOString(), embedding: [] });
    }
    await withTransaction(['agentMembers'], async (trx) => { await trx.query('FOR document IN @documents UPSERT { scopeAgentKey: document.scopeAgentKey, userOrganizationKey: document.userOrganizationKey, source: "explicit" } INSERT document UPDATE {} IN agentMembers', { documents }); });
    await audit(context, action, { scopeAgentKey: relation.key, userOrganizationKeys: targets.map((member) => member.key) }); return output(action, { granted: targets.map((member) => member.key) });
  }
  for (const member of targets) { const targetAccess = await evaluateScopeAccess(context, { scope: access.scope.key, member: member.key, action: 'read' }); if (rankAccessRole(targetAccess.effectiveRole) > rankAccessRole(access.effectiveRole)) throw new DomainToolExecutionError('higher_role_protected', 'Explicit access for a higher scope role cannot be revoked'); }
  const targetKeys = targets.map((member) => member.key);
  await withTransaction(['agentMembers'], async (trx) => { await trx.query('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @scopeAgentKey && grant.userOrganizationKey IN @targetKeys && grant.source == "explicit" REMOVE grant IN agentMembers', { scopeAgentKey: relation.key, targetKeys }); });
  const remaining = await Promise.all(targets.map(async (member) => { const decision = await evaluateAgentAccess(context, { scope: access.scope.key, agent: resolved.agent.key, member: member.key, action: 'run' }); return { userOrganizationKey: member.key, explicitGrantRemoved: true, effectiveAccessRemaining: decision.allowed, remainingSources: decision.agentAccessSources }; }));
  await audit(context, action, { scopeAgentKey: relation.key, userOrganizationKeys: targetKeys }); return output(action, { members: remaining });
}

async function directScopeMemberships(scopeKey: string) {
  const cursor = await db.query<{ key: string; scopeKey: string; userOrganizationKey: string; role: AccessRole; status: 'active' | 'suspended' }>('FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey RETURN MERGE(member, { key: member._key })', { scopeKey });
  return cursor.all();
}

async function inheritedScopeRole(scopeKey: string, membership: MembershipRecord): Promise<AccessRole | null> {
  if (membership.orgRole === 'owner' || membership.orgRole === 'admin') return membership.orgRole;
  const cursor = await db.query<{ members: Array<{ scopeKey: string; role: AccessRole }>; relations: Array<{ parentKey: string; childKey: string }> }>('RETURN { members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }', { membershipKey: membership.key });
  const data = await cursor.next(); const parentByChild = new Map((data?.relations ?? []).map((relation) => [relation.childKey, relation.parentKey])); const ancestors = new Set<string>(); let parent = parentByChild.get(scopeKey); while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
  return (data?.members ?? []).filter((member) => ancestors.has(member.scopeKey)).sort((left, right) => rankAccessRole(right.role) - rankAccessRole(left.role))[0]?.role ?? null;
}

async function executeScopeMember(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  const readAccess = await evaluateScopeAccess(context, { scope: input.scope, action: action === 'scope.member.list' || action === 'scope.member.read' ? 'read' : 'scope.agent.manage' });
  if (!readAccess.allowed) throw new DomainToolExecutionError('scope_forbidden', readAccess.reason);
  const scopeKey = readAccess.scope.key;
  const direct = await directScopeMemberships(scopeKey);
  const organizationMembers = await allOrganizationMembers(context.organizationKey);

  const memberProjection = async (member: MembershipRecord) => {
    const directRelation = direct.find((relation) => relation.userOrganizationKey === member.key) ?? null;
    const effective = await evaluateScopeAccess(context, { scope: scopeKey, member: member.key, action: 'read' });
    const inheritedRole = await inheritedScopeRole(scopeKey, member);
    return {
      userOrganizationKey: member.key,
      name: member.user.name,
      alias: member.user.alias,
      email: member.user.email,
      organizationRole: member.orgRole,
      organizationMembershipStatus: member.status,
      directScopeMemberKey: directRelation?.key ?? null,
      directRole: directRelation?.role ?? null,
      directStatus: directRelation?.status ?? null,
      inheritedRole,
      effectiveRole: effective.effectiveRole,
      accessSources: effective.accessSources,
      effectiveAccess: effective.allowed,
    };
  };

  if (action === 'scope.member.list') {
    const rows = [];
    for (const member of organizationMembers) {
      const projected = await memberProjection(member);
      if (!projected.effectiveRole && !projected.directScopeMemberKey) continue;
      if (input.query && !`${projected.name ?? ''} ${projected.email} ${projected.alias ?? ''}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) continue;
      if (input.status && projected.directStatus !== input.status) continue;
      if (input.role && projected.effectiveRole !== input.role) continue;
      if (input.source === 'direct' && !projected.accessSources.includes('direct-scope-membership')) continue;
      if (input.source === 'inherited' && projected.accessSources.every((source) => source === 'direct-scope-membership')) continue;
      rows.push(projected);
    }
    const result = page(rows, input); return output(action, { members: result.items, nextCursor: result.nextCursor });
  }

  const targets = await Promise.all(input.members.map(async (reference: string) => { const member = await resolveMembership(context, reference); if (!member) throw new DomainToolExecutionError('member_not_found', `${reference} was not found`); return member; }));
  if (action === 'scope.member.read') {
    const members = await Promise.all(targets.map(async (member) => {
      const projection = await memberProjection(member);
      const relationCursor = await db.query<{ agentKey: string }>('FOR relation IN scopeAgents FILTER relation.scopeKey == @scopeKey && relation.status == "active" RETURN { agentKey: relation.agentKey }', { scopeKey });
      const usableAgents = [];
      for (const relation of await relationCursor.all()) { const decision = await evaluateAgentAccess(context, { scope: scopeKey, agent: relation.agentKey, member: member.key, action: 'run' }); if (decision.allowed && decision.agent) usableAgents.push({ key: decision.agent.key, name: decision.agent.name, slug: decision.agent.slug, accessSources: decision.agentAccessSources }); }
      return { ...projection, agents: usableAgents };
    }));
    return output(action, { members });
  }

  if (rankAccessRole(readAccess.effectiveRole) < accessRoleRank.admin) throw new DomainToolExecutionError('scope_forbidden', 'Owner or admin scope access is required');
  const actor = human(context); const actorRank = rankAccessRole(readAccess.effectiveRole);
  const targetRelations = targets.map((target) => ({ target, relation: direct.find((candidate) => candidate.userOrganizationKey === target.key) ?? null }));
  const ownerCount = direct.filter((relation) => relation.role === 'owner' && relation.status === 'active').length;
  for (const { target, relation } of targetRelations) {
    if (relation && rankAccessRole(relation.role) > actorRank) throw new DomainToolExecutionError('higher_role_protected', 'A higher scope role cannot be changed');
    if (target.key === actor.userOrganization.key && (action === 'scope.member.add' || action === 'scope.member.role.update') && rankAccessRole(input.role) > rankAccessRole(relation?.role)) throw new DomainToolExecutionError('self_elevation', 'A member may not elevate its own direct scope role');
    if ((action === 'scope.member.remove' || action === 'scope.member.suspend' || action === 'scope.member.role.update') && relation?.role === 'owner' && ownerCount <= 1 && (action !== 'scope.member.role.update' || input.role !== 'owner')) throw new DomainToolExecutionError('last_scope_owner', 'The final active direct scope owner cannot be removed, suspended, or demoted');
  }
  const timestamp = new Date().toISOString();
  if (action === 'scope.member.add') {
    if (rankAccessRole(input.role) > actorRank) throw new DomainToolExecutionError('role_escalation', 'Cannot grant above the initiating role');
    if (targets.some((target) => target.status !== 'active')) throw new DomainToolExecutionError('membership_suspended', 'Only active organization members may be added to a scope');
    if (targetRelations.some(({ relation }) => relation)) throw new DomainToolExecutionError('scope_member_duplicate', 'A direct scope membership already exists; activate or update it instead');
    const documents = targets.map((target) => ({ _key: newId(), scopeKey, userOrganizationKey: target.key, role: input.role, status: 'active' }));
    await withTransaction(['scopeMembers'], async (trx) => { await trx.query('FOR document IN @documents INSERT document INTO scopeMembers', { documents }); });
  } else {
    if (targetRelations.some(({ relation }) => !relation)) throw new DomainToolExecutionError('scope_member_not_found', 'Every target must have a direct scope membership');
    const keys = targetRelations.map(({ relation }) => relation!.key);
    if (action === 'scope.member.role.update') { if (rankAccessRole(input.role) > actorRank) throw new DomainToolExecutionError('role_escalation', 'Cannot grant above the initiating role'); await withTransaction(['scopeMembers'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member._key IN @keys UPDATE member WITH { role: @role } IN scopeMembers', { keys, role: input.role }); }); }
    if (action === 'scope.member.activate') await withTransaction(['scopeMembers'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member._key IN @keys UPDATE member WITH { status: "active" } IN scopeMembers', { keys }); });
    if (action === 'scope.member.suspend') await withTransaction(['scopeMembers'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member._key IN @keys UPDATE member WITH { status: "suspended" } IN scopeMembers', { keys }); });
    if (action === 'scope.member.remove') await withTransaction(['scopeMembers'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member._key IN @keys REMOVE member IN scopeMembers', { keys }); });
  }
  const sync = await syncOrganizationAgentMembers(context);
  await audit(context, action, { scopeKey, userOrganizationKeys: targets.map((target) => target.key), changedAt: timestamp });
  return output(action, { scopeKey, userOrganizationKeys: targets.map((target) => target.key), sync, authorizationState: 'effective_immediately' });
}

async function providerRows(context: DomainToolContext) {
  const cursor = await db.query<any>(`
    FOR provider IN providers
      LET organizationProvider = FIRST(FOR link IN organizationProviders FILTER link.organizationKey == @organizationKey && link.providerKey == provider._key RETURN link)
      LET availableModels = (FOR relation IN modelProviders FILTER relation.providerKey == provider._key && relation.enabled == true FOR model IN models FILTER model._key == relation.modelKey && model.enabled == true RETURN { key: model._key, slug: model.slug, name: model.name, providerModelId: relation.providerModelId })
      LET allowedActions = UNIQUE(FLATTEN(FOR availableModel IN availableModels FOR route IN modelActions FILTER route.modelKey == availableModel.key && route.enabled == true FOR registeredAction IN actions FILTER registeredAction._key == route.actionKey RETURN registeredAction.slug))
       RETURN { key: provider._key, slug: provider.slug, name: provider.name, enabled: organizationProvider != null, models: availableModels, actions: allowedActions }
  `, { organizationKey: context.organizationKey });
  return cursor.all();
}

async function executeProvider(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  const org = await evaluateOrganizationAccess(context, { action });
  if (!org.allowed) throw new DomainToolExecutionError('organization_forbidden', org.reason);
  let providers = await providerRows(context);
  if (action === 'organization.provider.list') {
    if (input.status) providers = providers.filter((provider: any) => provider.enabled === (input.status === 'enabled'));
    if (input.query) providers = providers.filter((provider: any) => `${provider.name} ${provider.slug}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()));
    return output(action, { providers: providers.map((provider: any) => ({ key: provider.key, slug: provider.slug, name: provider.name, enabled: provider.enabled, credentialStatus: 'external', health: 'unknown', availableModels: provider.models })) });
  }
  const needle = input.provider?.toLocaleLowerCase(); const matches = providers.filter((provider: any) => provider.key === input.provider || provider.slug.toLocaleLowerCase() === needle || provider.name.toLocaleLowerCase() === needle);
  if (action === 'organization.provider.read') {
    return output(action, { matches: input.providers.map((reference: string) => { const lowered = reference.toLocaleLowerCase(); return { input: reference, results: providers.filter((provider: any) => provider.key === reference || provider.slug.toLocaleLowerCase() === lowered || provider.name.toLocaleLowerCase() === lowered).map((provider: any) => ({ ...provider, credentialStatus: 'external', health: 'unknown', routingEligible: provider.enabled && provider.models.length > 0, lastTestedAt: null, quota: null })) }; }) });
  }
  if (matches.length !== 1) throw new DomainToolExecutionError(matches.length ? 'provider_ambiguous' : 'provider_not_found', `${input.provider} resolved to ${matches.length} providers`);
  const provider = matches[0]!;
  if (action === 'organization.provider.enable') {
    await withTransaction(['organizationProviders'], async (trx) => { await trx.query('UPSERT { organizationKey: @organizationKey, providerKey: @providerKey } INSERT { _key: @key, organizationKey: @organizationKey, providerKey: @providerKey } UPDATE {} IN organizationProviders', { key: newId(), organizationKey: context.organizationKey, providerKey: provider.key }); });
    await audit(context, action, { providerKey: provider.key }); return output(action, { providerKey: provider.key, enabled: true, routingState: 'effective_immediately' });
  }
  if (action === 'organization.provider.disable') {
    const activeRuns = await db.query('FOR run IN agentRuns FILTER run.organizationKey == @organizationKey && run.status == "accepted" LIMIT 1 RETURN run._key', { organizationKey: context.organizationKey });
    if (await activeRuns.next()) return output(action, { providerKey: provider.key, warning: 'Provider has active calls; explicit operational review required' }, 'preview');
    await withTransaction(['organizationProviders'], async (trx) => { await trx.query('FOR link IN organizationProviders FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey REMOVE link IN organizationProviders', { organizationKey: context.organizationKey, providerKey: provider.key }); });
    await audit(context, action, { providerKey: provider.key }); return output(action, { providerKey: provider.key, enabled: false, routingState: 'effective_immediately' });
  }
  const started = Date.now(); const routingEligible = provider.enabled && provider.models.length > 0;
  providerSlugSchema.parse(provider.slug);
  const success = false;
  const message = 'Provider connectivity requires explicit per-call credentials and is not connected yet.';
  const data = { provider: provider.slug, success, status: success ? 'healthy' : routingEligible ? 'degraded' : 'unavailable', latencyMs: Date.now() - started, testedAt: new Date().toISOString(), message };
  await audit(context, action, { providerKey: provider.key, mode: input.mode, success }); return output(action, data);
}

async function executeOrganization(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  const decision = await evaluateOrganizationAccess(context, { organization: input.organization, action });
  if (!decision.allowed && !(action === 'organization.restore' && decision.reason === 'ORGANIZATION_ARCHIVED' && decision.effectiveRole === 'owner')) throw new DomainToolExecutionError('organization_forbidden', decision.reason);
  const organization = decision.organization;
  if (action === 'organization.read') {
    const counts = await db.query<any>('RETURN { members: LENGTH(FOR member IN userOrganizations FILTER member.organizationId == @key RETURN 1), scopes: LENGTH(FOR scope IN scopes FILTER scope.organizationKey == @key RETURN 1), agents: LENGTH(FOR relation IN scopeAgents FILTER relation.organizationKey == @key RETURN 1), providers: LENGTH(FOR link IN organizationProviders FILTER link.organizationKey == @key RETURN 1), rootScope: FIRST(FOR scope IN scopes FILTER scope.organizationKey == @key && LENGTH(FOR relation IN scopeScopes FILTER relation.childKey == scope._key && relation.deletedAt == null RETURN 1) == 0 RETURN { key: scope._key, name: scope.name }) }', { key: context.organizationKey });
    return output(action, { key: organization.key, name: organization.name, alias: organization.slug, slug: organization.slug, description: organization.description, status: organization.isActive ? 'active' : 'archived', rootScope: (await counts.next())?.rootScope ?? null, currentMembership: decision.membership, currentRole: decision.effectiveRole, ...(await (async () => { const cursor = await db.query<any>('RETURN { memberCount: LENGTH(FOR member IN userOrganizations FILTER member.organizationId == @key RETURN 1), scopeCount: LENGTH(FOR scope IN scopes FILTER scope.organizationKey == @key RETURN 1), linkedAgentCount: LENGTH(FOR relation IN scopeAgents FILTER relation.organizationKey == @key RETURN 1), enabledProviderCount: LENGTH(FOR link IN organizationProviders FILTER link.organizationKey == @key RETURN 1) }', { key: context.organizationKey }); return cursor.next(); })()), createdAt: organization.createdAt, updatedAt: organization.updatedAt });
  }
  if (action === 'organization.update') {
    if (input.alias) { const duplicate = await db.query('FOR organization IN organizations FILTER organization._key != @key && LOWER(organization.slug) == LOWER(@alias) LIMIT 1 RETURN true', { key: organization.key, alias: input.alias }); if (await duplicate.next()) throw new DomainToolExecutionError('organization_alias_duplicate', 'Organization alias is already in use'); }
    const patch = Object.fromEntries(Object.entries({ name: input.name, slug: input.alias, description: input.description, updatedAt: new Date().toISOString() }).filter(([, value]) => value !== undefined));
    await withTransaction(['organizations'], async (trx) => { await trx.query('UPDATE @key WITH @patch IN organizations', { key: organization.key, patch }); }); await audit(context, action, { fields: Object.keys(patch) }); return output(action, { organizationKey: organization.key, updated: patch });
  }
  if (organization.is_root) throw new DomainToolExecutionError('root_organization_protected', 'The root organization cannot be archived or restored through this tool');
  if (input.confirmation && input.confirmation !== organization.name && input.confirmation !== organization.key) throw new DomainToolExecutionError('confirmation_mismatch', 'Confirmation must match the organization name or key');
  if (action === 'organization.archive') {
    const timestamp = new Date().toISOString();
    await withTransaction(['organizations', 'userSessions'], async (trx) => { await trx.query('UPDATE @key WITH { isActive: false, metadata: MERGE(@metadata, { archivedAt: @timestamp, archiveReason: @reason }), updatedAt: @timestamp } IN organizations', { key: organization.key, metadata: organization.metadata, timestamp, reason: input.reason ?? null }); await trx.query('FOR session IN userSessions FOR member IN userOrganizations FILTER member.organizationId == @key && member.userId == session.userId && session.disconnectedAt == null UPDATE session WITH { disconnectedAt: @timestamp, updatedAt: @timestamp } IN userSessions', { key: organization.key, timestamp }); });
    await audit(context, action, { organizationKey: organization.key }); return output(action, { organizationKey: organization.key, status: 'archived', runtimeBlocked: true, schedulesResumed: false });
  }
  if (organization.isActive) throw new DomainToolExecutionError('organization_active', 'The organization is already active');
  const timestamp = new Date().toISOString(); await withTransaction(['organizations'], async (trx) => { await trx.query('UPDATE @key WITH { isActive: true, metadata: UNSET(@metadata, "archivedAt", "archiveReason"), updatedAt: @timestamp } IN organizations', { key: organization.key, metadata: organization.metadata, timestamp }); });
  await audit(context, action, { organizationKey: organization.key }); return output(action, { organizationKey: organization.key, status: 'active', schedulesResumed: false, providersRequireRetest: true });
}

async function executeAccess(action: DomainActionSlug, input: Input, context: DomainToolContext) {
  if (action.includes('.organization.')) { const decision = await evaluateOrganizationAccess(context, input); const safe = { allowed: decision.allowed, reason: decision.reason, effectiveRole: decision.effectiveRole }; return output(action, action.endsWith('.explain') ? { decision: safe, explanation: explainOrganizationDecision(decision) } : safe); }
  if (action.includes('.scope.')) { const decision = await evaluateScopeAccess(context, input as { scope: string; member?: string; action?: string }); const safe = { allowed: decision.allowed, effectiveRole: decision.effectiveRole, accessSources: decision.accessSources, reason: decision.reason }; return output(action, action.endsWith('.explain') ? { decision: safe, explanation: explainScopeDecision(decision) } : safe); }
  const decision = await evaluateAgentAccess(context, input as { scope: string; agent: string; member?: string; action?: 'read' | 'run' | 'delegate' | 'manage' }); const safe = { allowed: decision.allowed, effectiveScopeRole: decision.effectiveScopeRole, agentAccessSources: decision.agentAccessSources, reason: decision.reason }; return output(action, action.endsWith('.explain') ? { decision: safe, explanation: explainAgentDecision(decision) } : safe);
}

export async function executeAccessDomainTool(action: DomainActionSlug, input: Input, context: DomainToolContext): Promise<DomainToolResult> {
  if (action.startsWith('scope.member.')) return executeScopeMember(action, input, context);
  if (action.startsWith('scope.agent.')) return executeScopeAgent(action, input, context);
  if (action.startsWith('agent.member.')) return executeAgentMember(action, input, context);
  if (action.startsWith('organization.provider.')) return executeProvider(action, input, context);
  if (/^organization\.(read|update|archive|restore)$/.test(action)) return executeOrganization(action, input, context);
  if (action.startsWith('access.')) return executeAccess(action, input, context);
  throw new DomainToolExecutionError('unsupported_domain_action', `No local handler exists for ${action}`);
}
