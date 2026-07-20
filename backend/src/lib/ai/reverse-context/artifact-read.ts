import { z } from 'zod';
import { knowledgeBlockSchema, normalizeKnowledgeBlock, searchableNodeSchema } from './schema';
import { NodeContextNotFoundError, type NodeResolverRegistry } from './resolver';
import { AiError } from '@/lib/ai/shared/result';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { nodeTypeSchema } from '@/lib/ai/agent-run-sources';
import { organizationKeySchema } from '@/lib/ai/shared/ids';

export const artifactReadToolInputSchema = z.object({
  organizationKey: organizationKeySchema,
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  nodeType: nodeTypeSchema,
  nodeKey: z.string().cuid(),
}).strict();
export const artifactReadToolOutputSchema = knowledgeBlockSchema;

export class ArtifactReadGrantError extends AiError {
  constructor(detail: string) { super('artifact_read_grant_invalid', `Artifact Read Tool is unavailable: ${detail}`); }
}

/** Permission-checked lazy read. The resolver still controls the full safe projection. */
export async function executeArtifactReadTool(rawInput: z.input<typeof artifactReadToolInputSchema>, registry: NodeResolverRegistry) {
  const input = artifactReadToolInputSchema.parse(rawInput);
  const access = { organizationKey: input.organizationKey, scopeKey: input.scopeKey, agentKey: input.agentKey };
  const resolver = registry.get(input.nodeType);
  if (!await resolver.exists(input.nodeKey, access)) throw new NodeContextNotFoundError(input.nodeType, input.nodeKey);
  const node = await resolver.load(input.nodeKey, access);
  if (!node) throw new NodeContextNotFoundError(input.nodeType, input.nodeKey);
  const parsedNode = searchableNodeSchema.parse(node);
  if (parsedNode.organizationKey !== input.organizationKey || (parsedNode.scopeKey !== null && parsedNode.scopeKey !== input.scopeKey)) throw new NodeContextNotFoundError(input.nodeType, input.nodeKey);
  const block = normalizeKnowledgeBlock(knowledgeBlockSchema.parse(await resolver.extractContext(parsedNode, access, { full: true })));
  if (block.nodeType !== input.nodeType || block.nodeKey !== input.nodeKey) throw new NodeContextNotFoundError(input.nodeType, input.nodeKey);
  return artifactReadToolOutputSchema.parse(block);
}

/** Public callable boundary: verifies persisted tool/action ownership before lazy loading. */
export async function runArtifactReadTool(
  rawInput: z.input<typeof artifactReadToolInputSchema>,
  options: { registry: NodeResolverRegistry; runtimeData?: AgentRuntimeDataSource },
) {
  const input = artifactReadToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey || runtime.scope.key !== input.scopeKey) throw new ArtifactReadGrantError('agent context does not match organization and scope');
  const grant = runtime.tools.find(({ tool }) => tool.slug === 'artifact.read');
  if (!grant || grant.actions.length === 0) throw new ArtifactReadGrantError('agent is not granted artifact.read');
  return executeArtifactReadTool(input, options.registry);
}
