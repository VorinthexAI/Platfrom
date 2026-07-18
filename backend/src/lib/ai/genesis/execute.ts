import { AiError } from '@/lib/ai/shared/result';
import { runStoredAgentTool, type RunStoredAgentToolOptions } from '@/lib/ai/pipeline';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';
import { ArtifactResolverRegistry } from '@/lib/ai/artifact-resolvers';
import { ORGANIZATION_STEWARD_SKILL, ORGANIZATION_STEWARD_TOOL_SLUGS } from '@/lib/ai/steward';
import { compileGenesisContext, renderGenesisContext, type CompileGenesisContextOptions, type GenesisContext } from './context';
import { GENESIS_STEP_SLUGS, genesisCreationManifestSchema, genesisRunInputSchema, type GenesisCreationManifest, type GenesisRunInput } from './schemas';
import type { ValidateGenesisManifestOptions, ValidatedGenesisManifest } from './validation';
import type { GenesisTransactionGateway, PersistGenesisManifestResult } from './persistence';
import { CREATE_AGENT_ACTION_SLUG, CREATE_AGENT_TOOL_SLUG, createAgentToolInputSchema, executeCreateAgentTool, type CreateAgentToolOutput, type GenesisPlacementResolver } from './tool';

export class GenesisRuntimeConfigurationError extends AiError {
  constructor(detail: string) { super('genesis_runtime_invalid', `Genesis runtime is invalid: ${detail}`); }
}

export interface ExecuteGenesisOptions extends RunStoredAgentToolOptions, CompileGenesisContextOptions, ValidateGenesisManifestOptions {
  transaction?: GenesisTransactionGateway;
  placementResolver?: GenesisPlacementResolver;
}
export interface GenesisCreationResult {
  runKey: string;
  context: GenesisContext;
  manifest: GenesisCreationManifest;
  persisted: boolean;
  created?: PersistGenesisManifestResult;
  toolOutput: CreateAgentToolOutput;
  response: ProviderExecuteResponse<unknown>;
}

export const GENESIS_OUTPUT_SCHEMA_DESCRIPTION = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['metadata', 'agent', 'skills', 'agentSkills', 'agentTools', 'steps', 'validation'],
  note: 'Must satisfy the strict Genesis creation manifest schema exported by the backend.',
});

/** Reasons through core.reason, then invokes Genesis's sole agent.create capability. */
export async function createAgentFromGenesis(input: GenesisRunInput, options: ExecuteGenesisOptions = {}): Promise<GenesisCreationResult> {
  const parsed = genesisRunInputSchema.parse(input);
  const artifactResolvers = options.artifactResolvers ?? new ArtifactResolverRegistry();
  const context = await compileGenesisContext(parsed, { ...options, artifactResolvers });
  const createGrant = context.tools.find(({ tool }) => tool.slug === CREATE_AGENT_TOOL_SLUG);
  const createAction = createGrant?.actions.find(({ action }) => action.slug === CREATE_AGENT_ACTION_SLUG);
  if (context.tools.length !== 1 || !createGrant || createGrant.actions.length !== 1 || !createAction) {
    throw new GenesisRuntimeConfigurationError('Genesis must expose only agent.create mapped only to agent.create');
  }

  const outcome: { validated?: ValidatedGenesisManifest; created?: PersistGenesisManifestResult; toolOutput?: CreateAgentToolOutput } = {};
  const result = await runStoredAgentTool({
    organizationKey: parsed.organizationKey,
    agentKey: parsed.genesisAgentKey,
    toolKey: createGrant.tool.key,
    actionKey: createAction.action.key,
    stepSlug: 'produce-agent-manifest',
    metadata: { status: 'accepted', reason: 'Genesis request validated', score: 1 },
    input: {
      messages: [{ role: 'user', content: parsed.currentTask }],
      system: `You are Genesis. Return only the strict creation manifest.${parsed.profile === 'organization-steward' ? `\nThe requested profile is Organization Steward. Create or reuse this canonical skill: ${JSON.stringify(ORGANIZATION_STEWARD_SKILL)}. Attach every one of these existing tools: ${ORGANIZATION_STEWARD_TOOL_SLUGS.join(', ')}.` : ''}\n\nAgentContext:\n${renderGenesisContext(context)}`,
    },
    currentTask: parsed.currentTask,
    outputSchema: GENESIS_OUTPUT_SCHEMA_DESCRIPTION,
    sources: parsed.sourceRefs,
  }, {
    ...options,
    principal: options.principal ?? { kind: 'system' },
    artifactResolvers,
    allowRejectedOutput: true,
    reasoningActionSlug: 'core.reason',
    stepSlugs: GENESIS_STEP_SLUGS,
    beforeFinalize: async ({ run, response, principal, recordArtifactCreated }) => {
      const toolInput = createAgentToolInputSchema.parse({ organizationKey: parsed.organizationKey, scopeKey: parsed.scopeKey, agentRunKey: run.key, manifest: genesisCreationManifestSchema.parse(response.output) });
      const handled = await executeCreateAgentTool(toolInput, context, { ...options, principal, requestedMinimumAccessRole: parsed.minimumAccessRole, requiredProfile: parsed.profile });
      outcome.validated = handled.validated;
      outcome.created = handled.persisted;
      outcome.toolOutput = handled.output;
      for (const artifact of handled.persisted?.artifacts ?? []) {
        if (artifact.relation === 'result') await recordArtifactCreated({ nodeType: artifact.nodeType, nodeKey: artifact.nodeKey });
      }
    },
  });
  if (!result.executed || !outcome.validated || !outcome.toolOutput) throw new GenesisRuntimeConfigurationError('Genesis did not produce and execute a validated manifest');
  const manifest = genesisCreationManifestSchema.parse(outcome.validated.manifest);
  return { runKey: result.run.key, context, manifest, persisted: outcome.toolOutput.status !== 'rejected', created: outcome.created, toolOutput: outcome.toolOutput, response: result.response as ProviderExecuteResponse<unknown> };
}
