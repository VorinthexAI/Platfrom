import { db, withTransaction } from '@/lib/db/client';
import { insertEvent } from '@/lib/db/events.node';
import type { ResolvedExecutionPrincipal } from '@/lib/ai/agents/access';
import { newId } from '@/lib/ids';
import { AiError } from '@/lib/ai/shared/result';
import { getDefaultArtifactService } from '@/lib/artifacts/service';
import { recordRuntimeEvent, type RuntimeEventRecorder } from '@/platform/events';
import { domainToolInputSchemas, domainToolResultSchema, type DomainActionSlug, type DomainToolResult } from './domain-schemas';
import { executeAccessDomainTool, syncOrganizationAgentMembers } from './domain-execute-access-domains';
import { executeArchiveLifecycleTool, type ArchiveExecutionDependencies } from './domain-execute-archive';
import { isArchiveAction } from './domain-archive-schemas';
import { executeMomentumTool, type MomentumExecutionDependencies, type MomentumReasonInput } from '@/lib/ai/momentum';
import { isMomentumAction } from '@/lib/ai/momentum/tool-schemas';
import { coreChatInputSchema } from '@/lib/ai/actions';
import { executeAction } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers';
import { reconcileOrganizationScopeMemberships, scopeRoleForOrganizationRole } from '@/lib/ai/scopes/membership-invariant';

type RecordDoc = Record<string, unknown>;
type MemberRow = { membership: RecordDoc; user: RecordDoc };
type ScopeRow = RecordDoc & { _key: string; organizationKey: string; name: string; slug: string; description: string | null; position: number; level: number; deletedAt?: string | null };
type RelationRow = { _key: string; parentKey: string; childKey: string; deletedAt?: string | null };

const roleRank = { owner: 4, admin: 3, moderator: 2, member: 2, viewer: 1 } as const;
const rankOf = (role: unknown) => typeof role === 'string' && role in roleRank ? roleRank[role as keyof typeof roleRank] : 0;

export class DomainToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}

export interface DomainToolContext {
  organizationKey: string;
  runtimeScopeKey: string;
  principal: ResolvedExecutionPrincipal;
}

type ArtifactCreator = Pick<ReturnType<typeof getDefaultArtifactService>, 'create'>;

export interface DomainToolExecutionOptions {
  artifacts?: ArtifactCreator;
  domainEvents?: (context: DomainToolContext, action: DomainActionSlug, data: Record<string, unknown>) => Promise<void>;
  runtimeEvents?: RuntimeEventRecorder;
  momentum?: Partial<Omit<MomentumExecutionDependencies, 'authorize' | 'audit'>>;
  archive?: Partial<Omit<ArchiveExecutionDependencies, 'authorize' | 'emit'>>;
  authorizeScope?: (scopeKey: string, roles: readonly string[]) => Promise<void>;
}

function memberPrincipal(context: DomainToolContext) {
  if (context.principal.kind !== 'member') throw new DomainToolExecutionError('human_principal_required', 'A human organization member must initiate this operation');
  if (context.principal.userOrganization.organizationId !== context.organizationKey || context.principal.userOrganization.status !== 'active') {
    throw new DomainToolExecutionError('organization_forbidden', 'Active organization membership is required');
  }
  return context.principal;
}

async function listMemberRows(organizationKey: string): Promise<MemberRow[]> {
  const cursor = await db.query<MemberRow>(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @organizationKey
      FOR user IN users FILTER user._key == membership.userId
      RETURN { membership, user }
  `, { organizationKey });
  return cursor.all();
}

function memberView(row: MemberRow) {
  return {
    userOrganizationKey: row.membership._key,
    userKey: row.user._key,
    name: row.user.name ?? null,
    email: row.user.email,
    alias: row.user.alias ?? null,
    role: row.membership.orgRole,
    status: row.membership.status,
    title: row.membership.orgTitle ?? null,
  };
}

function matchesReference(row: MemberRow, reference: string) {
  const needle = reference.toLocaleLowerCase();
  return [row.membership._key, row.user._key, row.user.name, row.user.email, row.user.alias, row.user.alias_slug]
    .some((value) => typeof value === 'string' && value.toLocaleLowerCase() === needle);
}

function resolveMembers(rows: MemberRow[], references: string[], requireUnique: boolean) {
  return references.map((input) => {
    const results = rows.filter((row) => matchesReference(row, input));
    if (requireUnique && results.length !== 1) throw new DomainToolExecutionError(results.length === 0 ? 'member_not_found' : 'member_ambiguous', `${input} resolved to ${results.length} members`);
    return { input, results };
  });
}

async function listScopeGraph(organizationKey: string) {
  const [scopeCursor, relationCursor] = await Promise.all([
    db.query<ScopeRow>('FOR scope IN scopes FILTER scope.organizationKey == @organizationKey RETURN scope', { organizationKey }),
    db.query<RelationRow>('FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN relation'),
  ]);
  const scopes = await scopeCursor.all();
  const keys = new Set(scopes.map((scope) => scope._key));
  const relations = (await relationCursor.all()).filter((relation) => keys.has(relation.parentKey) && keys.has(relation.childKey));
  const byKey = new Map(scopes.map((scope) => [scope._key, scope]));
  const parentByChild = new Map(relations.map((relation) => [relation.childKey, relation.parentKey]));
  const childrenByParent = new Map<string, string[]>();
  for (const relation of relations) childrenByParent.set(relation.parentKey, [...(childrenByParent.get(relation.parentKey) ?? []), relation.childKey]);
  const pathOf = (scope: ScopeRow) => {
    const path: string[] = [];
    let current: ScopeRow | undefined = scope;
    const seen = new Set<string>();
    while (current && !seen.has(current._key)) { seen.add(current._key); path.unshift(current.name); current = byKey.get(parentByChild.get(current._key) ?? ''); }
    return path;
  };
  return { scopes, relations, byKey, parentByChild, childrenByParent, pathOf };
}

function resolveScopes(graph: Awaited<ReturnType<typeof listScopeGraph>>, references: string[], requireUnique: boolean) {
  return references.map((input) => {
    const needle = input.toLocaleLowerCase();
    const results = graph.scopes.filter((scope) => scope._key === input || scope.slug.toLocaleLowerCase() === needle || scope.name.toLocaleLowerCase() === needle || graph.pathOf(scope).join('/').toLocaleLowerCase() === needle);
    if (requireUnique && results.length !== 1) throw new DomainToolExecutionError(results.length === 0 ? 'scope_not_found' : 'scope_ambiguous', `${input} resolved to ${results.length} scopes`);
    return { input, results };
  });
}

async function effectiveScopeRole(context: DomainToolContext, scopeKey: string) {
  const principal = memberPrincipal(context);
  if (scopeKey !== context.runtimeScopeKey) {
    const scopeCursor = await db.query<{ organizationKey: string; deletedAt: string | null }>('FOR scope IN scopes FILTER scope._key == @scopeKey LIMIT 1 RETURN { organizationKey: scope.organizationKey, deletedAt: scope.deletedAt }', { scopeKey });
    const scope = await scopeCursor.next();
    if (!scope || scope.organizationKey !== context.organizationKey) throw new DomainToolExecutionError('scope_forbidden', 'The scope does not belong to the active organization');
  }
  if (principal.userOrganization.orgRole === 'owner') return 'owner' as const;
  if (principal.userOrganization.orgRole === 'admin') return 'admin' as const;
  const cursor = await db.query<{ members: Array<{ scopeKey: string; role: 'owner' | 'admin' | 'moderator' | 'viewer' }>; relations: Array<{ parentKey: string; childKey: string }> }>('RETURN { members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }', { membershipKey: principal.userOrganization.key });
  const data = await cursor.next(); const parentByChild = new Map((data?.relations ?? []).map((relation) => [relation.childKey, relation.parentKey])); const ancestors = new Set([scopeKey]); let parent = parentByChild.get(scopeKey); while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
  return (data?.members ?? []).filter((member) => ancestors.has(member.scopeKey)).sort((left, right) => rankOf(right.role) - rankOf(left.role))[0]?.role ?? null;
}

async function assertScopeRole(context: DomainToolContext, scopeKey: string, allowed: readonly string[]) {
  const role = await effectiveScopeRole(context, scopeKey);
  if (!role || !allowed.includes(role)) throw new DomainToolExecutionError('scope_forbidden', `Role ${role ?? 'none'} may not perform this operation`);
  return role;
}

async function assertOperationalScope(context: DomainToolContext, scopeKey: string, allowed: readonly string[]) {
  await assertScopeRole(context, scopeKey, allowed);
  const scopeCursor = await db.query<{ organizationKey: string; deletedAt: string | null }>('FOR scope IN scopes FILTER scope._key == @scopeKey LIMIT 1 RETURN { organizationKey: scope.organizationKey, deletedAt: scope.deletedAt }', { scopeKey });
  const scope = await scopeCursor.next();
  if (!scope || scope.organizationKey !== context.organizationKey) throw new DomainToolExecutionError('scope_forbidden', 'The scope does not belong to the active organization');
  if (scope.deletedAt !== null) throw new DomainToolExecutionError('scope_archived', 'Archived scopes cannot be mutated or searched');
}

async function emitDomainEvent(context: DomainToolContext, action: DomainActionSlug, data: Record<string, unknown>) {
  const principal = memberPrincipal(context);
  await insertEvent({ key: newId(), scopeId: context.runtimeScopeKey, userId: principal.user.key, slug: action, data, createdAt: new Date().toISOString() });
}

function result(action: DomainActionSlug, data: unknown, status: 'completed' | 'preview' = 'completed'): DomainToolResult {
  return domainToolResultSchema.parse({ action, status, data });
}

export async function executeDomainTool(action: DomainActionSlug, rawInput: unknown, context: DomainToolContext, options: DomainToolExecutionOptions = {}): Promise<DomainToolResult> {
  const input = domainToolInputSchemas[action].parse(rawInput) as any;
  const principal = memberPrincipal(context);
  const emit = options.domainEvents ?? emitDomainEvent;
  const authorizeScope = options.authorizeScope ?? (async (scopeKey: string, roles: readonly string[]) => { await assertOperationalScope(context, scopeKey, roles); });
  if (isArchiveAction(action)) {
    const data = await executeArchiveLifecycleTool(action, input, { ...context, userKey: principal.user.key }, {
      ...options.archive,
      authorize: authorizeScope,
      emit: (eventAction, eventData) => emit(context, eventAction, eventData),
    });
    return result(action, data);
  }
  if (isMomentumAction(action)) {
    const defaultReason = async (reasonInput: MomentumReasonInput) => {
      const prompt = reasonInput.action === 'summarize'
        ? `Summarize this task concisely.\n\nTitle: ${reasonInput.task.title}\n\n${reasonInput.task.description ?? ''}`
        : reasonInput.action === 'translate'
          ? `Translate this task into ${reasonInput.language}. Preserve meaning.\n\nTitle: ${reasonInput.task.title}\n\n${reasonInput.task.description ?? ''}`
          : `Rewrite this task according to: ${reasonInput.instruction}\n\nTitle: ${reasonInput.task.title}\n\n${reasonInput.task.description ?? ''}`;
      const response = await executeAction<ReturnType<typeof coreChatInputSchema.parse>, ChatOutput>(
        { mode: 'auto', organizationKey: context.organizationKey, actionSlug: 'reason' },
        coreChatInputSchema.parse({ systemPrompt: 'Return only the requested task text.', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] }),
      );
      return response.output.text;
    };
    const data = await executeMomentumTool(action, input, {
      repository: options.momentum?.repository,
      createKey: options.momentum?.createKey,
      now: options.momentum?.now,
      generateEmbedding: options.momentum?.generateEmbedding,
      reason: options.momentum?.reason ?? defaultReason,
      organizationScopeKeys: options.momentum?.organizationScopeKeys ?? (async () => {
        const cursor = await db.query<{ key: string }>('FOR scope IN scopes FILTER scope.organizationKey == @organizationKey && scope.deletedAt == null RETURN { key: scope._key }', { organizationKey: context.organizationKey });
        return (await cursor.all()).map(({ key }) => key);
      }),
      authorize: authorizeScope,
      audit: (eventAction, eventData) => emit(context, eventAction, eventData as Record<string, unknown>),
    });
    return result(action, data);
  }
  if (action.startsWith('scope.member.') || action.startsWith('scope.agent.') || action.startsWith('agent.member.') || action.startsWith('organization.provider.') || /^organization\.(read|update|archive|restore)$/.test(action) || action.startsWith('access.')) return executeAccessDomainTool(action, input, context);

  if (action === 'artifact.create') {
    await assertScopeRole(context, context.runtimeScopeKey, ['owner', 'admin', 'moderator']);
    const artifacts = options.artifacts ?? getDefaultArtifactService();
    const artifact = await artifacts.create({
      organizationKey: context.organizationKey,
      scopeKey: context.runtimeScopeKey,
      organizationWide: ['owner', 'admin'].includes(principal.userOrganization.orgRole),
      allowedScopeKeys: [context.runtimeScopeKey],
      name: input.name,
      definition: input.definition,
      createdByUserOrganizationKey: principal.userOrganization.key,
    });
    await (options.domainEvents ?? emitDomainEvent)(context, action, { artifactKey: artifact.key });
    await (options.runtimeEvents ?? recordRuntimeEvent)({
      scopeId: context.runtimeScopeKey,
      userId: principal.user.key,
      slug: 'artifact.created',
      data: { nodeType: 'artifacts', nodeKey: artifact.key },
    });
    return result(action, {
      artifact: {
        key: artifact.key,
        name: artifact.name,
        mode: artifact.definition.mode,
        root: artifact.definition.root,
        layout: artifact.definition.view.layout,
        theme: artifact.definition.view.theme,
      },
    });
  }

  if (action.startsWith('organization.member.')) {
    const rows = await listMemberRows(context.organizationKey);
    if (action === 'organization.member.list') {
      const filtered = rows.filter((row) => (!input.role || row.membership.orgRole === input.role) && (!input.status || row.membership.status === input.status) && (!input.name || String(row.user.name ?? '').toLocaleLowerCase().includes(input.name.toLocaleLowerCase())) && (!input.email || String(row.user.email).toLocaleLowerCase().includes(input.email.toLocaleLowerCase())) && (!input.alias || String(row.user.alias ?? '').toLocaleLowerCase().includes(input.alias.toLocaleLowerCase())));
      filtered.sort((a, b) => String(input.sort === 'role' ? a.membership.orgRole : input.sort === 'status' ? a.membership.status : input.sort === 'email' ? a.user.email : a.user.name ?? a.user.email).localeCompare(String(input.sort === 'role' ? b.membership.orgRole : input.sort === 'status' ? b.membership.status : input.sort === 'email' ? b.user.email : b.user.name ?? b.user.email)));
      const offset = input.cursor ? Number.parseInt(Buffer.from(input.cursor, 'base64url').toString('utf8'), 10) || 0 : 0;
      return result(action, { members: filtered.slice(offset, offset + input.limit).map(memberView), nextCursor: offset + input.limit < filtered.length ? Buffer.from(String(offset + input.limit)).toString('base64url') : null });
    }
    if (action === 'organization.member.read') return result(action, { matches: resolveMembers(rows, input.members, false).map(({ input: ref, results }) => ({ input: ref, results: results.map(memberView) })) });
    if (!['owner', 'admin'].includes(principal.userOrganization.orgRole)) throw new DomainToolExecutionError('organization_forbidden', 'Owner or admin role is required');
    if (action === 'organization.member.add') {
      if (rankOf(input.role) > rankOf(principal.userOrganization.orgRole)) throw new DomainToolExecutionError('role_escalation', 'Cannot grant a role above the initiating member role');
      const userCursor = await db.query<RecordDoc>('FOR user IN users FILTER user._key == @ref || LOWER(user.email) == LOWER(@ref) || LOWER(user.alias) == LOWER(@ref) || user.alias_slug == @ref RETURN user', { ref: input.member });
      const users = await userCursor.all();
      if (users.length !== 1) throw new DomainToolExecutionError(users.length ? 'member_ambiguous' : 'user_not_found', `${input.member} resolved to ${users.length} users`);
      if (rows.some((row) => row.user._key === users[0]!._key)) throw new DomainToolExecutionError('already_member', 'User already belongs to the organization');
      const now = new Date().toISOString(); const key = newId();
      await withTransaction(['userOrganizations', 'scopes', 'scopeMembers'], async (trx) => { await trx.query('INSERT { _key: @key, organizationId: @organizationKey, userId: @userId, orgRole: @role, orgTitle: null, status: "active", joinedAt: @now, isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null, createdAt: @now, updatedAt: @now, embedding: [] } INTO userOrganizations', { key, organizationKey: context.organizationKey, userId: users[0]!._key, role: input.role, now }); await reconcileOrganizationScopeMemberships(context.organizationKey, { userOrganizationKeys: [key] }, trx); });
      const sync = await syncOrganizationAgentMembers(context); await emitDomainEvent(context, action, { userOrganizationKey: key }); return result(action, { userOrganizationKey: key, role: input.role, status: 'active', sync });
    }
    const resolved = resolveMembers(rows, input.members, true).map(({ results }) => results[0]!);
    const owners = rows.filter((row) => row.membership.orgRole === 'owner');
    for (const row of resolved) {
      if (row.membership.orgRole === 'owner' && principal.userOrganization.orgRole !== 'owner') throw new DomainToolExecutionError('owner_protected', 'Only an owner may change another owner');
      if ((action === 'organization.member.remove' || action === 'organization.member.role.update') && row.membership.orgRole === 'owner' && owners.length <= 1 && (action === 'organization.member.remove' || input.role !== 'owner')) throw new DomainToolExecutionError('last_owner', 'The final owner cannot be removed or demoted');
      if (action === 'organization.member.role.update' && rankOf(input.role) > rankOf(principal.userOrganization.orgRole)) throw new DomainToolExecutionError('role_escalation', 'Cannot grant above the initiating role');
    }
    const keys = resolved.map((row) => row.membership._key as string); const now = new Date().toISOString();
    if (action === 'organization.member.role.update') await withTransaction(['userOrganizations', 'scopes', 'scopeMembers'], async (trx) => { await trx.query('FOR membership IN userOrganizations FILTER membership._key IN @keys UPDATE membership WITH { orgRole: @role, updatedAt: @now } IN userOrganizations', { keys, role: input.role, now }); await reconcileOrganizationScopeMemberships(context.organizationKey, { userOrganizationKeys: keys }, trx); });
    if (action === 'organization.member.activate') await withTransaction(['userOrganizations', 'scopes', 'scopeMembers'], async (trx) => { await trx.query('FOR membership IN userOrganizations FILTER membership._key IN @keys UPDATE membership WITH { status: "active", updatedAt: @now } IN userOrganizations', { keys, now }); await reconcileOrganizationScopeMemberships(context.organizationKey, { userOrganizationKeys: keys }, trx); });
    if (action === 'organization.member.suspend') await withTransaction(['userOrganizations', 'userSessions'], async (trx) => { await trx.query('FOR membership IN userOrganizations FILTER membership._key IN @keys UPDATE membership WITH { status: "suspended", updatedAt: @now } IN userOrganizations', { keys, now }); await trx.query('FOR session IN userSessions FILTER session.userId IN @userIds && session.disconnectedAt == null UPDATE session WITH { disconnectedAt: @now, updatedAt: @now } IN userSessions', { userIds: resolved.map((row) => row.user._key), now }); });
    if (action === 'organization.member.remove') await withTransaction(['userOrganizations', 'scopeMembers', 'agentMembers', 'userSessions'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member.userOrganizationKey IN @keys REMOVE member IN scopeMembers', { keys }); await trx.query('FOR grant IN agentMembers FILTER grant.userOrganizationKey IN @keys REMOVE grant IN agentMembers', { keys }); await trx.query('FOR session IN userSessions FILTER session.userId IN @userIds && session.disconnectedAt == null UPDATE session WITH { disconnectedAt: @now, updatedAt: @now } IN userSessions', { userIds: resolved.map((row) => row.user._key), now }); await trx.query('FOR membership IN userOrganizations FILTER membership._key IN @keys REMOVE membership IN userOrganizations', { keys }); });
    const sync = action === 'organization.member.role.update' || action === 'organization.member.activate' ? await syncOrganizationAgentMembers(context) : []; await emitDomainEvent(context, action, { userOrganizationKeys: keys }); return result(action, { userOrganizationKeys: keys, sync });
  }

  const graph = await listScopeGraph(context.organizationKey);
  const accessible = async (scope: ScopeRow) => (await effectiveScopeRole(context, scope._key)) !== null;
  if (action === 'scope.list') {
    const requestedStatus = input.status ?? 'active'; const candidates: ScopeRow[] = [];
    const includedParents = new Set<string>();
    if (input.parentScopeKey !== undefined && input.includeDescendants && input.parentScopeKey !== null) { const pending = [input.parentScopeKey]; while (pending.length) for (const child of graph.childrenByParent.get(pending.shift()!) ?? []) if (!includedParents.has(child)) { includedParents.add(child); pending.push(child); } }
    for (const scope of graph.scopes) if ((requestedStatus === 'archived') === Boolean(scope.deletedAt) && (!input.query || `${scope.name} ${scope.slug}`.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())) && (input.parentScopeKey === undefined || (input.includeDescendants ? input.parentScopeKey === null || includedParents.has(scope._key) : (graph.parentByChild.get(scope._key) ?? null) === input.parentScopeKey)) && await accessible(scope)) candidates.push(scope);
    candidates.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)); const offset = input.cursor ? Number.parseInt(Buffer.from(input.cursor, 'base64url').toString(), 10) || 0 : 0;
    return result(action, { scopes: candidates.slice(offset, offset + input.limit).map((scope) => ({ key: scope._key, name: scope.name, description: scope.description, parentScopeKey: graph.parentByChild.get(scope._key) ?? null, status: scope.deletedAt ? 'archived' : 'active', position: scope.position, level: scope.level, path: graph.pathOf(scope), childCount: (graph.childrenByParent.get(scope._key) ?? []).length })), nextCursor: offset + input.limit < candidates.length ? Buffer.from(String(offset + input.limit)).toString('base64url') : null });
  }
  if (action === 'scope.read') {
    const matches = resolveScopes(graph, input.scopes, false); const output = [];
    for (const match of matches) output.push({ input: match.input, results: (await Promise.all(match.results.map(async (scope) => {
      if (!await accessible(scope)) return null;
      const countCursor = await db.query<{ members: number; agents: number }>('RETURN { members: LENGTH(FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey RETURN 1), agents: LENGTH(FOR agent IN agents FILTER agent.scopeKey == @scopeKey RETURN 1) }', { scopeKey: scope._key });
      const counts = await countCursor.next() ?? { members: 0, agents: 0 };
      return { key: scope._key, name: scope.name, slug: scope.slug, description: scope.description, status: scope.deletedAt ? 'archived' : 'active', parentScopeKey: graph.parentByChild.get(scope._key) ?? null, children: graph.childrenByParent.get(scope._key) ?? [], position: scope.position, level: scope.level, path: graph.pathOf(scope), createdBy: null, createdAt: null, memberCount: counts.members, agentCount: counts.agents, policies: [] };
    }))).filter(Boolean) });
    return result(action, { matches: output });
  }
  const refs = action === 'scope.create' ? [] : action === 'scope.update' || action === 'scope.move' ? [input.scope] : input.scopes;
  const targets = refs.length ? resolveScopes(graph, refs, true).map(({ results }) => results[0]!) : [];
  if (action === 'scope.create') {
    const parent = input.parentScope == null ? null : resolveScopes(graph, [input.parentScope], true)[0]!.results[0]!;
    if (parent) { await assertScopeRole(context, parent._key, ['owner', 'admin', 'moderator']); if (parent.deletedAt) throw new DomainToolExecutionError('parent_archived', 'Parent scope is archived'); }
    else if (!['owner', 'admin'].includes(principal.userOrganization.orgRole)) throw new DomainToolExecutionError('scope_forbidden', 'Only organization owners or admins may create a root-level scope');
    if (graph.scopes.some((scope) => (graph.parentByChild.get(scope._key) ?? null) === (parent?._key ?? null) && scope.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new DomainToolExecutionError('duplicate_scope', 'A sibling scope already has this name');
    const key = newId(), relationKey = parent ? newId() : null; const slug = input.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); const level = (parent?.level ?? 0) + 1;
    await withTransaction(['scopes', 'scopeScopes', 'userOrganizations', 'scopeMembers'], async (trx) => { await trx.query('INSERT { _key: @key, organizationKey: @organizationKey, slug: @slug, name: @name, summary: @description, description: @description, position: @position, level: @level, deletedAt: null, embedding: [] } INTO scopes', { key, organizationKey: context.organizationKey, slug, name: input.name, description: input.description ?? input.name, position: input.position, level }); if (parent) await trx.query('INSERT { _key: @relationKey, parentKey: @parentKey, childKey: @key, level: @level, deletedAt: null } INTO scopeScopes', { relationKey, parentKey: parent._key, key, level }); await reconcileOrganizationScopeMemberships(context.organizationKey, { scopeKeys: [key] }, trx); });
    const sync = await syncOrganizationAgentMembers(context);
    await emitDomainEvent(context, action, { scopeKey: key }); return result(action, { key, slug, parentScopeKey: parent?._key ?? null, role: scopeRoleForOrganizationRole(principal.userOrganization.orgRole), sync });
  }
  for (const scope of targets) if (scope.organizationKey !== context.organizationKey) throw new DomainToolExecutionError('scope_forbidden', 'Scope belongs to another organization');
  if (action === 'scope.update') { const scope = targets[0]!; await assertScopeRole(context, scope._key, ['owner', 'admin', 'moderator']); if (scope.deletedAt) throw new DomainToolExecutionError('scope_archived', 'Restore the scope before updating it'); if (input.name && graph.scopes.some((candidate) => candidate._key !== scope._key && (graph.parentByChild.get(candidate._key) ?? null) === (graph.parentByChild.get(scope._key) ?? null) && candidate.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new DomainToolExecutionError('duplicate_scope', 'A sibling scope already has this name'); await withTransaction(['scopes'], async (trx) => { await trx.query('UPDATE @key WITH MERGE(@patch, { embedding: [] }) IN scopes', { key: scope._key, patch: Object.fromEntries(Object.entries({ name: input.name, description: input.description }).filter(([, value]) => value !== undefined)) }); }); await emitDomainEvent(context, action, { scopeKey: scope._key }); return result(action, { scopeKey: scope._key }); }
  if (action === 'scope.move') { const scope = targets[0]!; await assertScopeRole(context, scope._key, ['owner', 'admin']); if (!graph.parentByChild.has(scope._key)) throw new DomainToolExecutionError('root_scope_protected', 'Root scopes cannot be moved'); const parent = input.parentScope === undefined ? graph.byKey.get(graph.parentByChild.get(scope._key)!) ?? null : input.parentScope === null ? null : resolveScopes(graph, [input.parentScope], true)[0]!.results[0]!; if (parent?.deletedAt) throw new DomainToolExecutionError('parent_archived', 'Destination parent is archived'); let cursor = parent?._key; while (cursor) { if (cursor === scope._key) throw new DomainToolExecutionError('scope_cycle', 'Move would create a cycle'); cursor = graph.parentByChild.get(cursor); } const level = (parent?.level ?? 0) + 1; await withTransaction(['scopes', 'scopeScopes'], async (trx) => { if (input.parentScope !== undefined) { await trx.query('FOR relation IN scopeScopes FILTER relation.childKey == @scopeKey REMOVE relation IN scopeScopes', { scopeKey: scope._key }); if (parent) await trx.query('INSERT { _key: @key, parentKey: @parentKey, childKey: @scopeKey, level: @level, deletedAt: null } INTO scopeScopes', { key: newId(), parentKey: parent._key, scopeKey: scope._key, level }); await trx.query('UPDATE @scopeKey WITH { level: @level } IN scopes', { scopeKey: scope._key, level }); } if (input.position !== undefined) await trx.query('UPDATE @scopeKey WITH { position: @position } IN scopes', { scopeKey: scope._key, position: input.position }); }); const sync = await syncOrganizationAgentMembers(context); await emitDomainEvent(context, action, { scopeKey: scope._key }); return result(action, { scopeKey: scope._key, parentScopeKey: parent?._key ?? null, position: input.position ?? scope.position, sync }); }
  const expand = (initial: ScopeRow[]) => { const selected = new Map(initial.map((scope) => [scope._key, scope])); if (input.includeDescendants) { const pending = [...selected.keys()]; while (pending.length) for (const child of graph.childrenByParent.get(pending.shift()!) ?? []) if (!selected.has(child)) { selected.set(child, graph.byKey.get(child)!); pending.push(child); } } return [...selected.values()]; };
  const affected = expand(targets);
  if (action === 'scope.archive') { for (const scope of targets) { await assertScopeRole(context, scope._key, ['owner', 'admin']); if (!graph.parentByChild.has(scope._key)) throw new DomainToolExecutionError('root_scope_protected', 'Root scopes cannot be archived'); if (!input.includeDescendants && (graph.childrenByParent.get(scope._key) ?? []).some((key) => !graph.byKey.get(key)?.deletedAt)) throw new DomainToolExecutionError('active_children', 'Active children require includeDescendants'); } const keys = affected.map((scope) => scope._key); if (keys.length > 20) return result(action, { scopeKeys: keys, reason: 'Large subtree requires explicit review' }, 'preview'); const now = new Date().toISOString(); await withTransaction(['scopes'], async (trx) => { await trx.query('FOR scope IN scopes FILTER scope._key IN @keys UPDATE scope WITH { deletedAt: @now } IN scopes', { keys, now }); }); await emitDomainEvent(context, action, { scopeKeys: keys }); return result(action, { scopeKeys: keys, archivedAt: now }); }
  if (action === 'scope.restore') { for (const scope of targets) { await assertScopeRole(context, scope._key, ['owner', 'admin']); if (!scope.deletedAt) throw new DomainToolExecutionError('scope_active', 'Scope is already active'); const parent = graph.byKey.get(graph.parentByChild.get(scope._key) ?? ''); if (parent?.deletedAt) throw new DomainToolExecutionError('parent_archived', 'Restore the parent first'); } const keys = affected.map((scope) => scope._key); await withTransaction(['scopes'], async (trx) => { await trx.query('FOR scope IN scopes FILTER scope._key IN @keys UPDATE scope WITH { deletedAt: null } IN scopes', { keys }); }); const sync = await syncOrganizationAgentMembers(context); await emitDomainEvent(context, action, { scopeKeys: keys }); return result(action, { scopeKeys: keys, schedulesResumed: false, sync }); }
  for (const scope of targets) { await assertScopeRole(context, scope._key, ['owner']); if (!scope.deletedAt) throw new DomainToolExecutionError('scope_not_archived', 'Scope must be archived before removal'); if (!graph.parentByChild.has(scope._key)) throw new DomainToolExecutionError('root_scope_protected', 'Root scopes cannot be removed'); if ((graph.childrenByParent.get(scope._key) ?? []).length) throw new DomainToolExecutionError('scope_has_children', 'Scope with children cannot be removed'); if (input.confirmation !== scope.name && input.confirmation !== scope._key) throw new DomainToolExecutionError('confirmation_mismatch', `Confirmation must match ${scope.name} or its key`); }
  const keys = targets.map((scope) => scope._key); const activeRunCursor = await db.query<{ key: string }>('FOR run IN agentRuns FILTER run.scopeKey IN @keys && run.status == "accepted" LIMIT 1 RETURN { key: run._key }', { keys }); if (await activeRunCursor.next()) throw new DomainToolExecutionError('scope_has_active_runs', 'Scope with active runs cannot be removed'); await withTransaction(['scopes', 'scopeScopes', 'scopeMembers'], async (trx) => { await trx.query('FOR member IN scopeMembers FILTER member.scopeKey IN @keys REMOVE member IN scopeMembers', { keys }); await trx.query('FOR relation IN scopeScopes FILTER relation.parentKey IN @keys || relation.childKey IN @keys REMOVE relation IN scopeScopes', { keys }); await trx.query('FOR scope IN scopes FILTER scope._key IN @keys REMOVE scope IN scopes', { keys }); }); await emitDomainEvent(context, action, { scopeKeys: keys }); return result(action, { scopeKeys: keys });
}
