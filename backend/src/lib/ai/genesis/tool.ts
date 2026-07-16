import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { genesisCreationManifestSchema, genesisGuardrailsSchema } from './schemas';
import type { GenesisContext } from './context';
import { validateGenesisManifest, type ValidateGenesisManifestOptions, type ValidatedGenesisManifest } from './validation';
import { persistGenesisManifest, type GenesisTransactionGateway, type PersistGenesisManifestResult } from './persistence';

export const CREATE_AGENT_TOOL_SLUG = 'agent.create' as const;
export const CREATE_AGENT_ACTION_SLUG = 'agent.create' as const;

export const createAgentToolInputSchema = z.object({
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  manifest: genesisCreationManifestSchema,
}).strict();
export type CreateAgentToolInput = z.input<typeof createAgentToolInputSchema>;

export const createAgentToolOutputSchema = z.object({
  status: z.enum(['created', 'reused', 'rejected']),
  agentKey: z.string().cuid().nullable(),
  createdSkillKeys: z.array(z.string().cuid()),
  reusedSkillKeys: z.array(z.string().cuid()),
  agentSkillKeys: z.array(z.string().cuid()),
  agentToolKeys: z.array(z.string().cuid()),
  artifactKeys: z.array(z.string().cuid()),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type CreateAgentToolOutput = z.infer<typeof createAgentToolOutputSchema>;

export class CreateAgentToolGuardrailError extends AiError {
  constructor(detail: string) { super('agent_create_guardrail_violation', `agent.create rejected the request: ${detail}`); }
}

export interface ExecuteCreateAgentToolOptions extends ValidateGenesisManifestOptions {
  transaction?: GenesisTransactionGateway;
}
export interface ExecuteCreateAgentToolResult {
  output: CreateAgentToolOutput;
  validated: ValidatedGenesisManifest;
  persisted?: PersistGenesisManifestResult;
}

function assertExecutionGuardrails(input: z.infer<typeof createAgentToolInputSchema>, context: GenesisContext) {
  const guardrails = genesisGuardrailsSchema.parse(context.guardrails);
  if (input.organizationKey !== context.organization.key || guardrails.organizationKey !== input.organizationKey) {
    throw new CreateAgentToolGuardrailError('organization does not match the compiled Genesis context');
  }
  if (input.scopeKey !== context.scope.key || guardrails.scopeKey !== input.scopeKey) {
    throw new CreateAgentToolGuardrailError('scope does not match the compiled Genesis context');
  }
  if (context.scope.organizationKey !== input.organizationKey) {
    throw new CreateAgentToolGuardrailError('target scope belongs to another organization');
  }
  const grant = context.tools.find(({ tool }) => tool.slug === CREATE_AGENT_TOOL_SLUG);
  if (context.tools.length !== 1 || !grant || grant.actions.length !== 1 || grant.actions[0]?.action.slug !== CREATE_AGENT_ACTION_SLUG) {
    throw new CreateAgentToolGuardrailError('Genesis must own only agent.create mapped only to agent.create');
  }
}

/** Local handler for the only write capability granted to Genesis. */
export async function executeCreateAgentTool(
  rawInput: CreateAgentToolInput,
  context: GenesisContext,
  options: ExecuteCreateAgentToolOptions = {},
): Promise<ExecuteCreateAgentToolResult> {
  // This parse is intentionally repeated at the local action boundary.
  const input = createAgentToolInputSchema.parse(rawInput);
  assertExecutionGuardrails(input, context);
  const validated = await validateGenesisManifest(input.manifest, context, input.agentRunKey, options);
  if (validated.manifest.metadata.status === 'rejected') {
    return {
      validated,
      output: createAgentToolOutputSchema.parse({
        status: 'rejected', agentKey: null, createdSkillKeys: [], reusedSkillKeys: [],
        agentSkillKeys: [], agentToolKeys: [], artifactKeys: [], reason: validated.manifest.metadata.reason,
      }),
    };
  }

  const persisted = await persistGenesisManifest({ runKey: input.agentRunKey, context, validated }, options.transaction);
  return {
    validated,
    persisted,
    output: createAgentToolOutputSchema.parse({
      status: validated.manifest.agent.operation === 'reuse' ? 'reused' : 'created',
      agentKey: persisted.agent.key,
      createdSkillKeys: persisted.createdSkills.map(({ key }) => key),
      reusedSkillKeys: validated.manifest.skills.flatMap((skill) => skill.operation === 'reuse' ? [skill.skillKey] : []),
      agentSkillKeys: persisted.agentSkills.map(({ key }) => key),
      agentToolKeys: persisted.agentTools.map(({ key }) => key),
      artifactKeys: persisted.artifacts.map(({ key }) => key),
      reason: validated.manifest.metadata.reason,
    }),
  };
}
