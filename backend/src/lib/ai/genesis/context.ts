import { AiError } from '@/lib/ai/shared/result';
import { loadAgentRuntime, compileAgentContext, type AgentContext, type AgentRuntimeDataSource } from '@/lib/ai/agents';
import { getDefaultScopeRepository, scopesEmbedKeys, type Scope } from '@/lib/ai/scopes';
import { agentsEmbedKeys, getAllAgentsChunked, type Agent } from '@/lib/db/agents.node';
import { getAllSkillsChunked, skillsEmbedKeys, type Skill } from '@/lib/db/skills.node';
import { getAllToolsChunked, toolsEmbedKeys, type Tool } from '@/lib/db/tools.node';
import { ArtifactResolverRegistry, type ArtifactResolver, type OwnedArtifactReference, type SourcePermissionResolver } from '@/lib/ai/artifact-resolvers';
import type { RuntimeVariableRepository } from '@/lib/ai/runtime-variables';
import type { AgentMemoryRepository } from '@/lib/ai/agent-memories';
import { genesisGuardrailsSchema, genesisRunInputSchema, genesisSourcePolicySchema, type GenesisGuardrails, type GenesisRunInput } from './schemas';
import { createNodeResolver, NodeResolverRegistry, ReverseContextCompiler, type SearchableDocument } from '@/lib/ai/reverse-context';

export class GenesisIdentityError extends AiError {
  constructor(detail: string) { super('genesis_identity_invalid', `Invalid Genesis identity: ${detail}`); }
}
export class GenesisScopeMismatchError extends AiError {
  constructor() { super('genesis_scope_mismatch', 'Genesis and the requested scope must match'); }
}
export class GenesisOrganizationMismatchError extends AiError {
  constructor() { super('genesis_organization_mismatch', 'Genesis scope belongs to another organization'); }
}

export interface GenesisKnowledge {
  pack: AgentContext['knowledge']['pack'];
  existingAgents: readonly Agent[];
  existingSkills: readonly Skill[];
  existingTools: readonly Tool[];
  sources: AgentContext['artifacts'];
}
export interface GenesisContext extends Omit<AgentContext, 'guardrails' | 'knowledge'> {
  guardrails: GenesisGuardrails;
  knowledge: GenesisKnowledge;
}

export interface GenesisCatalogDataSource {
  listOrganizationScopes(organizationKey: string): Promise<readonly Scope[]>;
  listAgents(): Promise<readonly Agent[]>;
  listSkills(): Promise<readonly Skill[]>;
  listTools(): Promise<readonly Tool[]>;
}

async function collect<T>(scanner: (chunkSize?: number) => AsyncGenerator<T[], void, void>): Promise<T[]> {
  const values: T[] = [];
  for await (const chunk of scanner()) values.push(...chunk);
  return values;
}

const defaultCatalog: GenesisCatalogDataSource = {
  listOrganizationScopes: (organizationKey) => getDefaultScopeRepository().listScopes(organizationKey),
  listAgents: () => collect(getAllAgentsChunked),
  listSkills: () => collect(getAllSkillsChunked),
  listTools: () => collect(getAllToolsChunked),
};

export interface CompileGenesisContextOptions {
  runtimeData?: AgentRuntimeDataSource;
  catalog?: GenesisCatalogDataSource;
  variables?: RuntimeVariableRepository;
  memories?: AgentMemoryRepository;
  artifactResolvers?: ArtifactResolverRegistry;
  canUseSource?: SourcePermissionResolver;
  generateEmbedding?: (text: string) => Promise<readonly number[]>;
  knowledgeTokenBudget?: number;
}

function resolverFor(references: readonly OwnedArtifactReference[]): ArtifactResolver {
  const byKey = new Map(references.map((reference) => [reference.nodeKey, reference]));
  return {
    async exists(nodeKey) { return byKey.has(nodeKey); },
    async getReference(nodeKey) { return byKey.get(nodeKey) ?? null; },
    async getContent(nodeKey) { return byKey.get(nodeKey) ?? null; },
    async findSimilar() { return []; },
  };
}

function registerKnownResolvers(
  registry: ArtifactResolverRegistry,
  organizationKey: string,
  scopes: readonly Scope[],
  agents: readonly Agent[],
  skills: readonly Skill[],
  tools: readonly Tool[],
) {
  const registrations: Array<[string, OwnedArtifactReference[]]> = [
    ['scope', scopes.map((scope) => ({ nodeType: 'scope', nodeKey: scope.key, organizationKey, scopeKey: scope.key, name: scope.name, summary: scope.description ?? scope.summary }))],
    ['agent', agents.map((agent) => ({ nodeType: 'agent', nodeKey: agent.key, organizationKey, scopeKey: agent.scopeKey, name: agent.name, summary: agent.title }))],
    ['skill', skills.map((skill) => ({ nodeType: 'skill', nodeKey: skill.key, organizationKey, scopeKey: null, name: skill.title, summary: `${skill.name}: ${skill.definition.slice(0, 1_500)}` }))],
    ['tool', tools.map((tool) => ({ nodeType: 'tool', nodeKey: tool.key, organizationKey, scopeKey: tool.scopeKey, name: tool.name, summary: tool.description }))],
  ];
  for (const [nodeType, references] of registrations) {
    if (!registry.has(nodeType)) registry.register(nodeType, resolverFor(references));
  }
}

function catalogResolverRegistry(organizationKey: string, scopes: readonly Scope[], agents: readonly Agent[], skills: readonly Skill[], tools: readonly Tool[]) {
  const registry = new NodeResolverRegistry();
  const source = (documents: SearchableDocument[]) => {
    const searchable = documents.filter(({ embedding }) => embedding.length > 0);
    const byKey = new Map(searchable.map((document) => [document.key, document]));
    return { async get(key: string) { return byKey.get(key) ?? null; }, async list() { return searchable; } };
  };
  registry.register(createNodeResolver({ nodeType: 'scope', embeddingFields: scopesEmbedKeys.options, data: source(scopes.map((scope) => ({ ...scope, scopeKey: scope.key }))), titleField: 'summary', summaryFields: scopesEmbedKeys.options, canAccess: () => true }));
  registry.register(createNodeResolver({ nodeType: 'agent', embeddingFields: agentsEmbedKeys.options, data: source(agents.map((agent) => ({ ...agent, organizationKey }))), titleField: 'name', summaryFields: agentsEmbedKeys.options, canAccess: () => true }));
  registry.register(createNodeResolver({ nodeType: 'skill', embeddingFields: skillsEmbedKeys.options, data: source(skills.map((skill) => ({ ...skill, organizationKey, scopeKey: null }))), titleField: 'title', summaryFields: skillsEmbedKeys.options, canAccess: () => true }));
  registry.register(createNodeResolver({ nodeType: 'tool', embeddingFields: toolsEmbedKeys.options, data: source(tools.map((tool) => ({ ...tool, organizationKey }))), titleField: 'name', summaryFields: toolsEmbedKeys.options, canAccess: () => true }));
  return registry;
}

/** Compiles Genesis from resolved backend facts; no repository is exposed in the result. */
export async function compileGenesisContext(input: GenesisRunInput, options: CompileGenesisContextOptions = {}): Promise<GenesisContext> {
  const parsed = genesisRunInputSchema.parse(input);
  const runtime = await loadAgentRuntime(parsed.genesisAgentKey, options.runtimeData);
  if (runtime.agent.slug !== 'genesis' || runtime.agent.name !== 'Genesis' || runtime.agent.title !== 'Agent Architect') {
    throw new GenesisIdentityError(`${runtime.agent.slug}/${runtime.agent.name}/${runtime.agent.title}`);
  }
  if (runtime.organization.key !== parsed.organizationKey || runtime.scope.organizationKey !== parsed.organizationKey) {
    throw new GenesisOrganizationMismatchError();
  }
  if (runtime.scope.key !== parsed.scopeKey || runtime.agent.scopeKey !== parsed.scopeKey) throw new GenesisScopeMismatchError();

  const catalog = options.catalog ?? defaultCatalog;
  const [scopes, allAgents, skills, allTools] = await Promise.all([
    catalog.listOrganizationScopes(parsed.organizationKey), catalog.listAgents(), catalog.listSkills(), catalog.listTools(),
  ]);
  const scopeKeys = new Set(scopes.map((scope) => scope.key));
  const agents = allAgents.filter((agent) => scopeKeys.has(agent.scopeKey));
  const tools = allTools.filter((tool) => tool.scopeKey === null || scopeKeys.has(tool.scopeKey));
  const registry = options.artifactResolvers ?? new ArtifactResolverRegistry();
  registerKnownResolvers(registry, parsed.organizationKey, scopes, agents, skills, tools);
  const nodeResolvers = catalogResolverRegistry(parsed.organizationKey, scopes, agents, skills, tools);
  const reverseContextCompiler = new ReverseContextCompiler({
    registry: nodeResolvers,
    generateEmbedding: options.generateEmbedding,
    canUseNode: (node) => node.scopeKey === null || scopeKeys.has(node.scopeKey),
    defaultTopN: 20,
    defaultTokenBudget: options.knowledgeTokenBudget ?? 6_000,
  });
  const base = await compileAgentContext(runtime, {
    currentTask: parsed.currentTask,
    sources: parsed.sourceRefs,
    variables: options.variables,
    memories: options.memories,
    artifactResolvers: registry,
    canUseSource: options.canUseSource,
    reverseContextCompiler,
    knowledgeNodeTypes: nodeResolvers.listNodeTypes(),
    knowledgeTokenBudget: options.knowledgeTokenBudget ?? 6_000,
  });
  const requestedExplorationRate = parsed.requestedExplorationRate ?? runtime.agent.explorationRate ?? 0.2;
  const sourcePolicy = genesisSourcePolicySchema.parse({
    requestedExplorationRate,
    effectiveExplorationRate: base.artifacts.length === 0 ? 1 : requestedExplorationRate,
    sourceCount: base.artifacts.length,
  });
  const guardrails = genesisGuardrailsSchema.parse({
    organizationKey: parsed.organizationKey,
    scopeKey: parsed.scopeKey,
    allowedToolSlugs: ['agent.create'],
    allowedActionSlugs: ['agent.create'],
    canCreateAgents: true,
    canCreateSkills: true,
    canCreateAgentSkills: true,
    canCreateAgentTools: true,
    canCreateTools: false,
    canCreateActions: false,
    canCreateModels: false,
    canCreateProviders: false,
    canEnableProviders: false,
    canWriteArbitraryNodes: false,
    requireExistingTools: true,
    requireNoveltyValidation: true,
    requireTransactionalWrite: true,
    requireSameOrganization: true,
    requireScopePermission: true,
  });
  return {
    ...base,
    guardrails,
    sourcePolicy,
    knowledge: { pack: base.knowledge.pack, existingAgents: agents, existingSkills: skills, existingTools: tools, sources: base.artifacts },
  };
}

/** Provider-safe projection. Embeddings and storage internals are deliberately omitted. */
export function renderGenesisContext(context: GenesisContext): string {
  return JSON.stringify({
    organization: { key: context.organization.key, name: context.organization.name },
    scope: { key: context.scope.key, slug: context.scope.slug, name: context.scope.name, description: context.scope.description },
    agent: { key: context.agent.key, slug: context.agent.slug, name: context.agent.name, title: context.agent.title },
    skills: context.skills.map(({ relation, skill }) => ({ key: skill.key, slug: skill.slug, name: skill.name, title: skill.title, definition: skill.definition, priority: relation.priority })),
    tools: context.tools.map(({ tool, actions }) => ({ key: tool.key, slug: tool.slug, name: tool.name, description: tool.description, actions: actions.map(({ action }) => ({ key: action.key, slug: action.slug })) })),
    variables: context.variables,
    memories: context.memories.map(({ content, memoryType, importance }) => ({ content, memoryType, importance })),
    knowledge: {
      pack: context.knowledge.pack,
      sources: context.knowledge.sources,
    },
    permissions: context.permissions,
    guardrails: context.guardrails,
    sourcePolicy: context.sourcePolicy,
    currentTask: context.currentTask,
  });
}
