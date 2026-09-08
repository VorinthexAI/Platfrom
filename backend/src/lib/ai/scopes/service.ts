import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { evaluateTeamAccess, evaluateScopeAccess, resolveScopeMembershipAccess, type AccessRole, type TeamAccessDecision, type ScopeAccessDecision } from '@/lib/ai/tools/domain-access-engine';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { signedImageUrl } from '@/lib/gallery/image-url';
import { PRODUCT_SCOPE_SLUGS } from '@/lib/apps/registry';
import { createScopeRepository, SCOPE_REMOVAL_WRITE_COLLECTIONS } from './repository';
import { reconcileTeamScopeMemberships, scopeRoleForTeamRole } from './membership-invariant';
import { scopeMemberSchema, scopeSchema, type Scope, type ScopeMemberRole } from './schema';
import type { ScopesDatabase } from './types';

const scopeNameSchema = z.string().trim().min(1).max(160);
const scopeDescriptionSchema = z.string().trim().min(1).max(10_000);

export const scopeListInputSchema = z.object({}).strict();
export const scopeCreateInputSchema = z.object({
  name: scopeNameSchema,
  description: scopeDescriptionSchema.optional(),
}).strict();
export const scopeSelectInputSchema = z.object({ targetScopeKey: z.string().cuid() }).strict();
export const scopePrioritizeInputSchema = z.object({ targetScopeKey: z.string().cuid() }).strict();
export const scopeUpdateInputSchema = z.object({ targetScopeKey: z.string().cuid(), coverImageKey: z.string().cuid().nullable() }).strict();
export const scopeDeleteInputSchema = z.object({ targetScopeKey: z.string().cuid() }).strict();

export type PublicScope = {
  key: string;
  slug: string;
  name: string;
  summary: string;
  description: string | null;
  coverImageKey: string | null;
  coverUrl: string | null;
  position: number;
  level: number;
  role: ScopeMemberRole;
  isCurrent: boolean;
};

export class ScopeServiceError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'ScopeServiceError';
  }
}

type TransactionDatabase = ScopesDatabase & { query<T = unknown>(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<T[]>; next(): Promise<T | undefined> }> };

export interface ScopeServiceDependencies {
  listScopes?: (teamKey: string) => Promise<readonly Scope[]>;
  authorizeTeam?: (context: ToolContext, action: string) => Promise<TeamAccessDecision>;
  authorizeScope?: (context: ToolContext, scopeKey: string, action?: string) => Promise<ScopeAccessDecision>;
  materializeMemberships?: (teamKey: string, userTeamKey: string, scopeKeys?: readonly string[]) => Promise<void>;
  createInTransaction?: (input: { teamKey: string; userKey: string; name: string; description: string | null; idempotencyKey: string }) => Promise<{ scope: Scope; role: ScopeMemberRole; currentScopeKey: string }>;
  selectInTransaction?: (input: { teamKey: string; userKey: string; teamMembershipKey: string; targetScopeKey: string }) => Promise<{ scope: Scope; role: ScopeMemberRole }>;
  prioritizeInTransaction?: (input: ScopeMutationActor & { targetScopeKey: string }) => Promise<Scope>;
  updateInTransaction?: (input: ScopeMutationActor & { targetScopeKey: string; coverImageKey: string | null }) => Promise<{ scope: Scope; coverStorageKey?: string }>;
  deleteInTransaction?: (input: ScopeMutationActor & { targetScopeKey: string }) => Promise<void>;
  coverStorageKey?: (scopeKey: string, coverImageKey?: string | null) => Promise<string | undefined>;
  signImage?: (storageKey: string) => Promise<string>;
}

type ScopeMutationActor = {
  teamKey: string;
  userKey: string;
  teamMembershipKey: string;
  assuredTeamMembershipKey: string | null;
  assuredTeamMfaVersion: number | null;
};

const scopeManagerTransactionState = `
  LET actor = DOCUMENT(userTeams, @teamMembershipKey)
  LET team = DOCUMENT(teams, @teamKey)
  LET target = DOCUMENT(scopes, @targetScopeKey)
  LET directMembership = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @targetScopeKey && member.userTeamKey == @teamMembershipKey LIMIT 1 RETURN member)
  LET scopeMemberships = (FOR member IN scopeMembers FILTER member.userTeamKey == @teamMembershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role })
  LET scopeRelations = (FOR relation IN scopeScopes RETURN { parentKey: relation.parentKey, childKey: relation.childKey })
  LET exactAssurance = team != null && (team.mfa_enabled != true || actor != null && actor.isMfaEnabled == true && @assuredTeamMembershipKey == actor._key && @assuredTeamMfaVersion == (HAS(actor, "teamMfaVersion") ? actor.teamMfaVersion : 0))
  LET teamAuthorized = actor != null && actor.userId == @userKey && actor.teamKey == @teamKey && actor.status == "active" && team != null && team.isActive == true && exactAssurance
`;

type ScopeMutationState = {
  teamAuthorized: boolean;
  actorTeamRole?: string;
  directMembership: { role: AccessRole; status: string } | null;
  scopeMemberships: Array<{ scopeKey: string; role: AccessRole }>;
  scopeRelations: Array<{ parentKey: string; childKey: string }>;
  found: boolean;
};

function transactionScopeManagerAllowed(state: ScopeMutationState | undefined, scopeKey: string) {
  if (!state?.teamAuthorized || state.directMembership?.status === 'suspended') return false;
  if (state.actorTeamRole === 'owner' || state.actorTeamRole === 'admin') return true;
  const access = resolveScopeMembershipAccess(scopeKey, state.directMembership, { members: state.scopeMemberships, relations: state.scopeRelations });
  return access.effectiveRole === 'owner' || access.effectiveRole === 'admin';
}

function memberContext(context: ToolContext) {
  if (context.principal.kind !== 'member') throw new ScopeServiceError('FORBIDDEN', 'Authenticated user context is required.');
  const { user, userTeam } = context.principal;
  if (userTeam.userId !== user.key || userTeam.teamKey !== context.teamKey || userTeam.status !== 'active') {
    throw new ScopeServiceError('FORBIDDEN', 'Active team membership is required.');
  }
  return { user, membership: userTeam };
}

function roleFromDecision(role: AccessRole | null): ScopeMemberRole {
  if (!role) throw new ScopeServiceError('FORBIDDEN', 'Active scope membership is required.');
  return role;
}

function project(scope: Scope, role: ScopeMemberRole, currentScopeKey: string, coverUrl: string | null): PublicScope {
  return {
    key: scope.key,
    slug: scope.slug,
    name: scope.name,
    summary: scope.summary,
    description: scope.description,
    coverImageKey: scope.coverImageKey ?? null,
    coverUrl,
    position: scope.position,
    level: scope.level,
    role,
    isCurrent: scope.key === currentScopeKey,
  };
}

function slugBase(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150) || 'scope';
}

function summaryFor(name: string, description: string | null) {
  if (!description) return `${name} workspace`;
  const normalized = description.replace(/\s+/g, ' ').trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237).trimEnd()}...`;
}

function idempotentScopeKey(teamKey: string, userKey: string, idempotencyKey: string) {
  return `c${createHash('sha256').update(['scope.create', teamKey, userKey, idempotencyKey].join('\0')).digest('hex').slice(0, 24)}`;
}

async function defaultCreateInTransaction(input: Parameters<NonNullable<ScopeServiceDependencies['createInTransaction']>>[0]) {
  return withTransaction({ read: ['users', 'userTeams'], write: ['scopes', 'scopeMembers', 'emailTones'] }, async (transaction) => {
    const database = transaction as unknown as TransactionDatabase;
    const repository = createScopeRepository(database);
    const actorCursor = await database.query<{ teamRole: string; currentScopeKey: string }>(`
      LET user = DOCUMENT(users, @userKey)
      LET membership = FIRST(FOR item IN userTeams FILTER item.teamKey == @teamKey && item.userId == @userKey && item.status == "active" && item.teamRole IN ["owner", "admin"] LIMIT 1 RETURN item)
      FILTER user != null && membership != null
      RETURN { teamRole: membership.teamRole, currentScopeKey: user.currentScopeKey }
    `, { teamKey: input.teamKey, userKey: input.userKey });
    const actor = await actorCursor.next();
    if (!actor) throw new ScopeServiceError('FORBIDDEN', 'Only active team owners and admins may create scopes.');
    const key = idempotentScopeKey(input.teamKey, input.userKey, input.idempotencyKey);
    const existing = await repository.getScopeByKey(key);
    if (existing) {
      if (existing.teamKey !== input.teamKey || existing.name !== input.name || existing.description !== input.description) {
        throw new ScopeServiceError('CONFLICT', 'The idempotency key was already used for a different scope request.');
      }
      return { scope: existing, role: scopeRoleForTeamRole(actor.teamRole), currentScopeKey: actor.currentScopeKey };
    }

    const scopes = await repository.listScopes(input.teamKey);
    const usedSlugs = new Set(scopes.map(({ slug }) => slug));
    const base = slugBase(input.name);
    let slug = base;
    for (let suffix = 2; usedSlugs.has(slug); suffix += 1) slug = `${base.slice(0, Math.max(1, 159 - String(suffix).length))}-${suffix}`;
    const created = await repository.createScope({
      key,
      teamKey: input.teamKey,
      slug,
      name: input.name,
      summary: summaryFor(input.name, input.description),
      description: input.description,
      position: Math.max(0, ...scopes.map(({ position }) => position)) + 1,
    });
    await reconcileTeamScopeMemberships(input.teamKey, { scopeKeys: [created.key] }, database);
    return { scope: created, role: scopeRoleForTeamRole(actor.teamRole), currentScopeKey: actor.currentScopeKey };
  });
}

async function defaultSelectInTransaction(input: Parameters<NonNullable<ScopeServiceDependencies['selectInTransaction']>>[0]) {
  return withTransaction({ read: ['teams', 'userTeams', 'scopes', 'scopeMembers'], write: ['users'] }, async (transaction) => {
    const cursor = await transaction.query(`
      LET user = DOCUMENT(users, @userKey)
      LET membership = DOCUMENT(userTeams, @teamMembershipKey)
      LET scope = DOCUMENT(scopes, @targetScopeKey)
      LET scopeMembership = FIRST(FOR member IN scopeMembers FILTER member.scopeKey == @targetScopeKey && member.userTeamKey == @teamMembershipKey && member.status == "active" LIMIT 1 RETURN member)
      FILTER user != null && membership != null && membership.userId == @userKey && membership.teamKey == @teamKey && membership.status == "active"
      FILTER scope != null && scope.teamKey == @teamKey && scopeMembership != null && scopeMembership.status == "active"
      UPDATE user WITH { currentScopeKey: scope._key, updatedAt: @now } IN users
      RETURN { scope, scopeMembership }
    `, { ...input, now: new Date().toISOString() });
    const result = await cursor.next() as { scope?: Record<string, unknown>; scopeMembership?: Record<string, unknown> } | undefined;
    if (!result?.scope || !result.scopeMembership) throw new ScopeServiceError('FORBIDDEN', 'Active target scope membership is required.');
    return {
      scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
      role: scopeMemberSchema.parse({ ...result.scopeMembership, key: result.scopeMembership._key }).role,
    };
  });
}

async function defaultPrioritizeInTransaction(input: Parameters<NonNullable<ScopeServiceDependencies['prioritizeInTransaction']>>[0]) {
  return withTransaction({ read: ['teams', 'userTeams', 'scopeMembers', 'scopeScopes'], write: ['scopes'] }, async (transaction) => {
    const stateCursor = await transaction.query(`
      ${scopeManagerTransactionState}
      RETURN { teamAuthorized, actorTeamRole: actor.teamRole, directMembership, scopeMemberships, scopeRelations, found: target != null && target.teamKey == @teamKey }
    `, input);
    const state = await stateCursor.next() as ScopeMutationState | undefined;
    if (!transactionScopeManagerAllowed(state, input.targetScopeKey)) throw new ScopeServiceError('FORBIDDEN', 'Only active scope owners and admins may prioritize this scope.');
    if (!state?.found) throw new ScopeServiceError('NOT_FOUND', 'Scope was not found in this team.');
    const cursor = await transaction.query(`
      LET target = DOCUMENT(scopes, @targetScopeKey)
      LET orderedKeys = (FOR scope IN scopes FILTER scope.teamKey == @teamKey && scope._key != @targetScopeKey SORT scope.position ASC, scope._key ASC RETURN scope._key)
      LET prioritizedKeys = APPEND([target._key], orderedKeys)
      FOR scopeKey IN prioritizedKeys
        UPDATE scopeKey WITH { position: POSITION(prioritizedKeys, scopeKey, true) + 1 } IN scopes
        RETURN NEW
    `, { teamKey: input.teamKey, targetScopeKey: input.targetScopeKey });
    const scopes = await cursor.all() as Record<string, unknown>[];
    return scopeSchema.parse({ ...scopes[0], key: scopes[0]!._key });
  });
}

async function defaultUpdateInTransaction(input: Parameters<NonNullable<ScopeServiceDependencies['updateInTransaction']>>[0]) {
  return withTransaction({ read: ['teams', 'userTeams', 'scopeMembers', 'scopeScopes', 'images'], write: ['scopes'] }, async (transaction) => {
    const stateCursor = await transaction.query(`
      ${scopeManagerTransactionState}
      LET scope = DOCUMENT(scopes, @targetScopeKey)
      LET cover = @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
      RETURN { teamAuthorized, actorTeamRole: actor.teamRole, directMembership, scopeMemberships, scopeRelations, found: scope != null && scope.teamKey == @teamKey, coverAllowed: @coverImageKey == null || cover != null && cover.scopeKey == scope._key }
    `, input);
    const state = await stateCursor.next() as (ScopeMutationState & { coverAllowed: boolean }) | undefined;
    if (!transactionScopeManagerAllowed(state, input.targetScopeKey)) throw new ScopeServiceError('FORBIDDEN', 'Only active scope owners and admins may update this scope.');
    if (!state?.found) throw new ScopeServiceError('NOT_FOUND', 'Scope was not found in this team.');
    if (!state.coverAllowed) throw new ScopeServiceError('NOT_FOUND', 'Cover image was not found in the target scope.');
    const cursor = await transaction.query(`
      LET scope = DOCUMENT(scopes, @targetScopeKey)
      LET cover = @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
      UPDATE scope WITH { coverImageKey: @coverImageKey } IN scopes
      RETURN { scope: NEW, coverStorageKey: cover.storageKey }
    `, { targetScopeKey: input.targetScopeKey, coverImageKey: input.coverImageKey });
    const row = await cursor.next() as { scope?: Record<string, unknown>; coverStorageKey?: string } | undefined;
    if (!row?.scope) throw new ScopeServiceError('CONFLICT', 'Scope changed while its cover was being updated; retry the operation.');
    return { scope: scopeSchema.parse({ ...row.scope, key: row.scope._key }), ...(row.coverStorageKey ? { coverStorageKey: row.coverStorageKey } : {}) };
  });
}

async function defaultDeleteInTransaction(input: Parameters<NonNullable<ScopeServiceDependencies['deleteInTransaction']>>[0]) {
  return withTransaction({ read: ['teams'], write: [...SCOPE_REMOVAL_WRITE_COLLECTIONS] }, async (transaction) => {
    const cursor = await transaction.query(`
      ${scopeManagerTransactionState}
      LET scope = DOCUMENT(scopes, @targetScopeKey)
      LET scopeCount = scope == null ? 0 : LENGTH(FOR sibling IN scopes FILTER sibling.teamKey == @teamKey LIMIT 2 RETURN 1)
      LET currentCount = LENGTH(FOR user IN users FILTER user.currentScopeKey == @targetScopeKey LIMIT 1 RETURN 1)
      RETURN { teamAuthorized, actorTeamRole: actor.teamRole, directMembership, scopeMemberships, scopeRelations, found: scope != null && scope.teamKey == @teamKey, protected: scope != null && team != null && team.is_root == true && scope.slug IN @productSlugs, last: scopeCount <= 1, current: currentCount > 0 }
    `, { ...input, productSlugs: PRODUCT_SCOPE_SLUGS });
    const state = await cursor.next() as (ScopeMutationState & { protected: boolean; last: boolean; current: boolean }) | undefined;
    if (!transactionScopeManagerAllowed(state, input.targetScopeKey)) throw new ScopeServiceError('FORBIDDEN', 'Only active scope owners and admins may delete this scope.');
    if (!state?.found) throw new ScopeServiceError('NOT_FOUND', 'Scope was not found in this team.');
    if (state.protected) throw new ScopeServiceError('CONFLICT', 'Protected product scopes cannot be deleted.');
    if (state.current) throw new ScopeServiceError('CONFLICT', 'A current scope cannot be deleted. Select another scope first.');
    if (state.last) throw new ScopeServiceError('CONFLICT', 'The last scope in a team cannot be deleted.');
    await createScopeRepository(transaction as unknown as TransactionDatabase).removeScope(input.targetScopeKey);
  });
}

export function createScopeService(dependencies: ScopeServiceDependencies = {}) {
  const authorizeTeam = dependencies.authorizeTeam ?? ((context, action) => evaluateTeamAccess(context, { action }));
  const authorizeScope = dependencies.authorizeScope ?? ((context, scopeKey, action = 'read') => evaluateScopeAccess(context, { scope: scopeKey, action }));
  const listScopes = dependencies.listScopes ?? ((teamKey) => createScopeRepository().listScopes(teamKey));
  const coverStorageKey = dependencies.coverStorageKey ?? ((scopeKey, imageKey) => createScopeRepository().coverStorageKey(scopeKey, imageKey));
  const signImage = dependencies.signImage ?? signedImageUrl;
  const materializeMemberships = dependencies.materializeMemberships ?? (async (teamKey, userTeamKey, scopeKeys) => { await reconcileTeamScopeMemberships(teamKey, { userTeamKeys: [userTeamKey], scopeKeys }, db); });
  const publicScope = async (scope: Scope, role: ScopeMemberRole, currentScopeKey: string, knownCoverStorageKey?: string) => {
    const storageKey = knownCoverStorageKey ?? await coverStorageKey(scope.key, scope.coverImageKey);
    return project(scope, role, currentScopeKey, storageKey ? await signImage(storageKey) : null);
  };
  const requireScopeManager = async (context: ToolContext, scopeKey: string, action: string) => {
    let decision: ScopeAccessDecision;
    try {
      decision = await authorizeScope(context, scopeKey, action);
    } catch {
      throw new ScopeServiceError('FORBIDDEN', 'Only active scope owners and admins may manage this scope.');
    }
    if (!decision.allowed || (decision.effectiveRole !== 'owner' && decision.effectiveRole !== 'admin')) throw new ScopeServiceError('FORBIDDEN', 'Only active scope owners and admins may manage this scope.');
    return decision.effectiveRole;
  };
  const mutationActor = (context: ToolContext) => {
    const { user, membership } = memberContext(context);
    return {
      user,
      input: {
        teamKey: context.teamKey,
        userKey: user.key,
        teamMembershipKey: membership.key,
        assuredTeamMembershipKey: context.teamAssurance?.teamMembershipKey ?? null,
        assuredTeamMfaVersion: context.teamAssurance?.teamMfaVersion ?? null,
      },
    };
  };
  return {
    async list(_input: z.input<typeof scopeListInputSchema>, context: ToolContext): Promise<{ scopes: PublicScope[] }> {
      scopeListInputSchema.parse(_input);
      const { user, membership } = memberContext(context);
      const team = await authorizeTeam(context, 'scope.list');
      if (!team.allowed) throw new ScopeServiceError('FORBIDDEN', 'Active team membership is required.');
      await materializeMemberships(context.teamKey, membership.key);
      const scopes = await listScopes(context.teamKey);
      const visible: PublicScope[] = [];
      for (const scope of scopes) {
        const decision = await authorizeScope(context, scope.key);
        if (decision.allowed) visible.push(await publicScope(scope, roleFromDecision(decision.effectiveRole), user.currentScopeKey));
      }
      return { scopes: visible };
    },

    async create(rawInput: z.input<typeof scopeCreateInputSchema>, context: ToolContext, idempotencyKey: string): Promise<PublicScope> {
      const input = scopeCreateInputSchema.parse(rawInput);
      const requestKey = `scope.create:${z.string().trim().min(1).max(200).parse(idempotencyKey)}`;
      const { user } = memberContext(context);
      const team = await authorizeTeam(context, 'scope.create');
      if (!team.allowed || (team.effectiveRole !== 'owner' && team.effectiveRole !== 'admin')) {
        throw new ScopeServiceError('FORBIDDEN', 'Only team owners and admins may create scopes.');
      }
      const created = await (dependencies.createInTransaction ?? defaultCreateInTransaction)({
        teamKey: context.teamKey,
        userKey: user.key,
        name: input.name,
        description: input.description ?? null,
        idempotencyKey: requestKey,
      });
      return publicScope(created.scope, created.role, created.currentScopeKey);
    },

    async select(rawInput: z.input<typeof scopeSelectInputSchema>, context: ToolContext): Promise<PublicScope> {
      const input = scopeSelectInputSchema.parse(rawInput);
      const { user, membership } = memberContext(context);
      await materializeMemberships(context.teamKey, membership.key, [input.targetScopeKey]);
      let decision: ScopeAccessDecision;
      try {
        decision = await authorizeScope(context, input.targetScopeKey);
      } catch {
        throw new ScopeServiceError('FORBIDDEN', 'Active target scope membership is required.');
      }
      if (!decision.allowed) throw new ScopeServiceError('FORBIDDEN', 'Active target scope membership is required.');
      const selected = await (dependencies.selectInTransaction ?? defaultSelectInTransaction)({ teamKey: context.teamKey, userKey: user.key, teamMembershipKey: membership.key, targetScopeKey: input.targetScopeKey });
      return publicScope(selected.scope, selected.role, selected.scope.key);
    },

    async prioritize(rawInput: z.input<typeof scopePrioritizeInputSchema>, context: ToolContext): Promise<PublicScope> {
      const input = scopePrioritizeInputSchema.parse(rawInput);
      const { user, input: actor } = mutationActor(context);
      const role = await requireScopeManager(context, input.targetScopeKey, 'scope.prioritize');
      const prioritized = await (dependencies.prioritizeInTransaction ?? defaultPrioritizeInTransaction)({ ...actor, targetScopeKey: input.targetScopeKey });
      return publicScope(prioritized, role, user.currentScopeKey);
    },

    async update(rawInput: z.input<typeof scopeUpdateInputSchema>, context: ToolContext): Promise<PublicScope> {
      const input = scopeUpdateInputSchema.parse(rawInput);
      const { user, input: actor } = mutationActor(context);
      const role = await requireScopeManager(context, input.targetScopeKey, 'scope.update');
      const updated = await (dependencies.updateInTransaction ?? defaultUpdateInTransaction)({ ...actor, ...input });
      return publicScope(updated.scope, role, user.currentScopeKey, updated.coverStorageKey);
    },

    async delete(rawInput: z.input<typeof scopeDeleteInputSchema>, context: ToolContext): Promise<{ deleted: true; scopeKey: string }> {
      const input = scopeDeleteInputSchema.parse(rawInput);
      const { input: actor } = mutationActor(context);
      await requireScopeManager(context, input.targetScopeKey, 'scope.delete');
      await (dependencies.deleteInTransaction ?? defaultDeleteInTransaction)({ ...actor, targetScopeKey: input.targetScopeKey });
      return { deleted: true, scopeKey: input.targetScopeKey };
    },
  };
}

export type ScopeService = ReturnType<typeof createScopeService>;
export const scopeService = createScopeService();

export async function resolveScopeManagementContext(userKey: string, teamKey: string, teamAssurance?: ToolContext['teamAssurance']): Promise<ToolContext> {
  const cursor = await db.query(`
    LET user = DOCUMENT(users, @userKey)
    LET membership = FIRST(FOR item IN userTeams FILTER item.teamKey == @teamKey && item.userId == @userKey && item.status == "active" LIMIT 1 RETURN item)
    FILTER user != null && membership != null
    RETURN { user, membership }
  `, { userKey: z.string().trim().min(1).parse(userKey), teamKey: z.string().trim().min(1).max(160).parse(teamKey) });
  const result = await cursor.next() as { user?: Record<string, unknown>; membership?: Record<string, unknown> } | undefined;
  if (!result?.user || !result.membership) throw new ScopeServiceError('FORBIDDEN', 'Active team membership is required.');
  const { userSchema } = await import('@/lib/db/users.node');
  const { userTeamSchema } = await import('@/lib/db/user-team.node');
  const user = userSchema.parse({ ...result.user, key: result.user._key });
  const membership = userTeamSchema.parse({ ...result.membership, key: result.membership._key });
  return { teamKey, runtimeScopeKey: user.currentScopeKey, principal: { kind: 'member', user, userTeam: membership, scopeMember: null }, teamAssurance };
}
