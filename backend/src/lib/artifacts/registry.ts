import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { agentSchema } from '@/lib/db/agents.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { scopeSchema } from '@/lib/ai/scopes/schema';
import { agentRunSchema } from '@/lib/ai/agent-runs/schema';
import { organizationSchema } from '@/lib/db/organizations.node';
import type { NodeRef, ArtifactLiteral } from './types';

export interface ArtifactResolveContext { organizationKey: string; scopeKey: string }
export interface ResolvedValue { value: ArtifactLiteral; revision: string }

function revision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function publicAgent(value: z.infer<typeof agentSchema>) {
  return { key: value.key, slug: value.slug, name: value.name, title: value.title, scopeKey: value.scopeKey, explorationRate: value.explorationRate };
}
function publicRun(value: z.infer<typeof agentRunSchema>) {
  return { key: value.key, agentKey: value.agentKey, scopeKey: value.scopeKey, status: value.status, reason: value.reason, score: value.score, startedAt: value.startedAt, endedAt: value.endedAt, elapsedMs: value.elapsedMs, createdAt: value.createdAt };
}

export const ARTIFACT_NODE_TYPES = ['agents', 'agentRuns', 'scopeAgents', 'scopes', 'organizations'] as const;
type NodeLoader = (key: string, context: ArtifactResolveContext) => Promise<ArtifactLiteral | null>;

async function document(collectionName: string, key: string): Promise<Record<string, unknown> | null> {
  try { return withArangoKey(await db.collection(collectionName).document(key) as Record<string, unknown>); }
  catch (error) { if (typeof error === 'object' && error && 'errorNum' in error && (error as { errorNum: number }).errorNum === 1202) return null; throw error; }
}

const nodeLoaders: Record<(typeof ARTIFACT_NODE_TYPES)[number], NodeLoader> = {
  async agents(key, context) {
    const raw = await document('agents', key); if (!raw) return null;
    const agent = agentSchema.parse(raw); if (agent.scopeKey !== context.scopeKey) return null;
    return publicAgent(agent);
  },
  async agentRuns(key, context) {
    const raw = await document('agentRuns', key); if (!raw) return null;
    const run = agentRunSchema.parse(raw); if (run.organizationKey !== context.organizationKey || run.scopeKey !== context.scopeKey) return null;
    return publicRun(run);
  },
  async scopeAgents(key, context) {
    const raw = await document('scopeAgents', key); if (!raw) return null;
    const link = scopeAgentSchema.parse(raw); if (link.organizationKey !== context.organizationKey || link.scopeKey !== context.scopeKey) return null;
    return { key: link.key, agentKey: link.agentKey, scopeKey: link.scopeKey, status: link.status, position: link.position, minimumAccessRole: link.minimumAccessRole };
  },
  async scopes(key, context) {
    const raw = await document('scopes', key); if (!raw) return null;
    const scope = scopeSchema.parse(raw); if (scope.organizationKey !== context.organizationKey || scope.key !== context.scopeKey) return null;
    return { key: scope.key, slug: scope.slug, name: scope.name, summary: scope.summary, description: scope.description, position: scope.position };
  },
  async organizations(key, context) {
    if (key !== context.organizationKey) return null;
    const raw = await document('organizations', key); if (!raw) return null;
    const organization = organizationSchema.parse(raw);
    return { key: organization.key, name: organization.name, slug: organization.slug, isActive: organization.isActive };
  },
};

export async function resolveArtifactNode(ref: NodeRef, context: ArtifactResolveContext): Promise<ResolvedValue> {
  const loader = nodeLoaders[ref.type as keyof typeof nodeLoaders];
  if (!loader) throw new Error(`Artifact node type is not registered: ${ref.type}`);
  const value = await loader(ref.key, context);
  if (value === null) throw new Error(`Artifact node was not found or is outside the selected scope: ${ref.type}/${ref.key}`);
  return { value, revision: revision(value) };
}

export const ARTIFACT_QUERY_IDS = {
  SCOPE_ACTIVE_AGENTS: 'scope.active-agents',
  AGENT_RUNS_RECENT: 'agent.runs.recent',
  ORGANIZATION_MEMBER_COUNTS: 'organization.member-counts',
} as const;

export interface ArtifactQueryDefinition<Input> {
  id: string;
  inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  authorize(input: Input, context: ArtifactResolveContext): void;
  execute(input: Input, context: ArtifactResolveContext): Promise<ArtifactLiteral>;
  dependencies(input: Input, context: ArtifactResolveContext): string[];
  invalidatedBy: readonly string[];
}

const scopeInput = z.object({ scopeKey: z.string().cuid() }).strict();
const recentRunsInput = z.object({ scopeKey: z.string().cuid(), limit: z.number().int().min(1).max(100).default(20) }).strict();
const organizationInput = z.object({ organizationKey: z.string().trim().min(1) }).strict();

function requireScope(input: { scopeKey: string }, context: ArtifactResolveContext) { if (input.scopeKey !== context.scopeKey) throw new Error('Query scope is outside artifact authorization context'); }
function requireOrganization(input: { organizationKey: string }, context: ArtifactResolveContext) { if (input.organizationKey !== context.organizationKey) throw new Error('Query organization is outside artifact authorization context'); }

const queryRegistry = new Map<string, ArtifactQueryDefinition<unknown>>();
function register<Input>(definition: ArtifactQueryDefinition<Input>) { queryRegistry.set(definition.id, definition as ArtifactQueryDefinition<unknown>); }

register<z.infer<typeof scopeInput>>({
  id: ARTIFACT_QUERY_IDS.SCOPE_ACTIVE_AGENTS, inputSchema: scopeInput, authorize: requireScope,
  async execute(input, context) {
    const cursor = await db.query(`FOR link IN scopeAgents FILTER link.organizationKey == @organizationKey AND link.scopeKey == @scopeKey AND link.status == "active" FOR agent IN agents FILTER agent._key == link.agentKey SORT link.position ASC RETURN { agent, position: link.position }`, { organizationKey: context.organizationKey, scopeKey: input.scopeKey });
    return (await cursor.all() as Array<{ agent: Record<string, unknown>; position: number }>).map((row) => ({ ...publicAgent(agentSchema.parse(withArangoKey(row.agent))), position: row.position }));
  },
  dependencies: (input) => [`scope:${input.scopeKey}`, 'query:scope.active-agents'], invalidatedBy: ['scope.agent.add', 'scope.agent.move', 'scope.agent.archive', 'scope.agent.restore', 'scope.agent.remove', 'scope.agent.access-threshold.update'],
});
register<z.infer<typeof recentRunsInput>>({
  id: ARTIFACT_QUERY_IDS.AGENT_RUNS_RECENT, inputSchema: recentRunsInput, authorize: requireScope,
  async execute(input, context) {
    const cursor = await db.query(`FOR run IN agentRuns FILTER run.organizationKey == @organizationKey AND run.scopeKey == @scopeKey SORT run.createdAt DESC LIMIT @limit RETURN run`, { organizationKey: context.organizationKey, scopeKey: input.scopeKey, limit: input.limit });
    return (await cursor.all()).map((raw) => publicRun(agentRunSchema.parse(withArangoKey(raw as Record<string, unknown>))));
  },
  dependencies: (input) => [`scope:${input.scopeKey}`, 'query:agent.runs.recent'], invalidatedBy: ['agent.started', 'agent.completed', 'agent.failed'],
});
register<z.infer<typeof organizationInput>>({
  id: ARTIFACT_QUERY_IDS.ORGANIZATION_MEMBER_COUNTS, inputSchema: organizationInput, authorize: requireOrganization,
  async execute(input) {
    const cursor = await db.query(`FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey COLLECT status = membership.status WITH COUNT INTO count RETURN { status, count }`, { organizationKey: input.organizationKey });
    return await cursor.all() as ArtifactLiteral;
  },
  dependencies: (_input, context) => [`organization:${context.organizationKey}`, 'query:organization.member-counts'], invalidatedBy: ['organization.member.add', 'organization.member.role.update', 'organization.member.activate', 'organization.member.suspend', 'organization.member.remove'],
});

export async function resolveArtifactQuery(queryId: string, variables: unknown, context: ArtifactResolveContext): Promise<ResolvedValue & { dependencies: string[]; invalidatedBy: readonly string[] }> {
  const definition = queryRegistry.get(queryId);
  if (!definition) throw new Error(`Artifact query is not registered: ${queryId}`);
  const input = definition.inputSchema.parse(variables);
  definition.authorize(input, context);
  const value = await definition.execute(input, context);
  return { value, revision: revision(value), dependencies: definition.dependencies(input, context), invalidatedBy: definition.invalidatedBy };
}

export function isRegisteredArtifactQuery(queryId: string): boolean { return queryRegistry.has(queryId); }

export function artifactQueryIdsInvalidatedBy(eventSlug: string): string[] {
  return [...queryRegistry.values()].filter((definition) => definition.invalidatedBy.includes(eventSlug)).map((definition) => definition.id);
}
