import { z } from 'zod';
import { guardrailSchema } from '@/lib/ai/guardrails';
import { toolIdSchema } from '@/lib/ai/tools/types';
import { isDotNotationId } from '@/lib/ai/shared/ids';
import { routingStrategySchema } from '@/lib/ai/router/types';

/**
 * An agent composes tools (never providers or models directly): the
 * execution chain is Agent → Tool → Action → Router → Model → Provider.
 * Its `skill` is the SKILL.md instruction body compiled into the system
 * prompt; its guardrails (scopeId-only, by spec) allow-list the
 * organization scopes whose tools it may invoke.
 */
export const agentDefinitionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .refine(isDotNotationId, { message: 'agent ids use <domain>.<agent> dot notation' }),
    name: z.string().min(1),
    description: z.string().min(1),
    /** SKILL.md instruction body — see ./skill.ts for the file format. */
    skill: z.string().min(1),
    toolIds: z.array(toolIdSchema).min(1),
    guardrails: z.array(guardrailSchema).default([]),
    defaultStrategy: routingStrategySchema.default('balanced'),
  })
  .strict();

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
