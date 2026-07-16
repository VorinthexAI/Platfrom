import { AiError } from '@/lib/ai/shared/result';
import { runStoredAgentTool, type RunStoredAgentToolOptions } from '@/lib/ai/pipeline';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';
import { ArtifactResolverRegistry } from '@/lib/ai/artifact-resolvers';
import { compileGenesisContext, renderGenesisContext, type CompileGenesisContextOptions, type GenesisContext } from './context';
import { GENESIS_STEP_SLUGS, genesisCreationManifestSchema, genesisRunInputSchema, type GenesisCreationManifest, type GenesisRunInput } from './schemas';
import { validateGenesisManifest, type ValidateGenesisManifestOptions, type ValidatedGenesisManifest } from './validation';
import { persistGenesisManifest, type GenesisTransactionGateway, type PersistGenesisManifestResult } from './persistence';

export class GenesisRuntimeConfigurationError extends AiError {
  constructor(detail: string) { super('genesis_runtime_invalid', `Genesis runtime is invalid: ${detail}`); }
}

export interface ExecuteGenesisOptions extends RunStoredAgentToolOptions, CompileGenesisContextOptions, ValidateGenesisManifestOptions {
  transaction?: GenesisTransactionGateway;
}
export interface GenesisCreationResult {
  runKey: string;
  context: GenesisContext;
  manifest: GenesisCreationManifest;
  persisted: boolean;
  created?: PersistGenesisManifestResult;
  response: ProviderExecuteResponse<unknown>;
}

export const GENESIS_OUTPUT_SCHEMA_DESCRIPTION = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['metadata', 'agent', 'skills', 'agentSkills', 'agentTools', 'steps', 'validation'],
  note: 'Must satisfy the strict Genesis creation manifest schema exported by the backend.',
});

/** Executes Genesis only through its persisted Reason Tool → core.reason route. */
export async function createAgentFromGenesis(input: GenesisRunInput, options: ExecuteGenesisOptions = {}): Promise<GenesisCreationResult> {
  const parsed = genesisRunInputSchema.parse(input);
  const artifactResolvers = options.artifactResolvers ?? new ArtifactResolverRegistry();
  const context = await compileGenesisContext(parsed, { ...options, artifactResolvers });
  const reasonGrant = context.tools.find(({ tool }) => tool.slug === 'reason.solve');
  const reasonAction = reasonGrant?.actions.find(({ action }) => action.slug === 'core.reason');
  if (!reasonGrant || !reasonAction) throw new GenesisRuntimeConfigurationError('Reason Tool must expose core.reason');

  const outcome: { validated?: ValidatedGenesisManifest; created?: PersistGenesisManifestResult } = {};
  const result = await runStoredAgentTool({
    organizationKey: parsed.organizationKey,
    agentKey: parsed.genesisAgentKey,
    toolKey: reasonGrant.tool.key,
    actionKey: reasonAction.action.key,
    stepSlug: 'produce-agent-manifest',
    metadata: { status: 'accepted', reason: 'Genesis request validated', score: 1 },
    input: {
      messages: [{ role: 'user', content: parsed.currentTask }],
      system: `You are Genesis. Return only the strict creation manifest.\n\nAgentContext:\n${renderGenesisContext(context)}`,
    },
    currentTask: parsed.currentTask,
    outputSchema: GENESIS_OUTPUT_SCHEMA_DESCRIPTION,
    sources: parsed.sourceRefs,
  }, {
    ...options,
    artifactResolvers,
    allowRejectedOutput: true,
    stepSlugs: GENESIS_STEP_SLUGS,
    beforeFinalize: async ({ run, response }) => {
      outcome.validated = await validateGenesisManifest(response.output, context, run.key, options);
      if (outcome.validated.manifest.metadata.status === 'accepted') {
        outcome.created = await persistGenesisManifest({ runKey: run.key, context, validated: outcome.validated }, options.transaction);
      }
    },
  });
  if (!result.executed || !outcome.validated) throw new GenesisRuntimeConfigurationError('Reason Tool did not produce a validated manifest');
  const manifest = genesisCreationManifestSchema.parse(outcome.validated.manifest);
  return { runKey: result.run.key, context, manifest, persisted: manifest.metadata.status === 'accepted', created: outcome.created, response: result.response as ProviderExecuteResponse<unknown> };
}
