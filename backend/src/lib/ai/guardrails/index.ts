import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';

/**
 * A guardrail contains ONLY a scopeId — nothing else, by spec. An agent's
 * guardrails form a strict allow-list over scopes: a
 * guardrailed agent may only invoke tools whose `scopeId` appears in its
 * guardrail list. An agent with no guardrails is unrestricted.
 */
export const guardrailSchema = z
  .object({
    scopeId: z.string().min(1),
  })
  .strict();

export type Guardrail = z.infer<typeof guardrailSchema>;

export class GuardrailViolationError extends AiError {
  constructor(agentId: string, toolId: string, detail: string) {
    super('guardrail_violation', `Agent ${agentId} may not use tool ${toolId}: ${detail}`);
  }
}

interface ScopedTool {
  id: string;
  scopeId: string | null;
}

/**
 * Allow-list semantics mirroring organizationProviders: presence of
 * guardrails RESTRICTS. No guardrails → every tool allowed. With
 * guardrails → only tools scoped to one of the allowed scopeIds; an
 * unscoped tool is denied for a guardrailed agent.
 */
export function isToolAllowedByGuardrails(guardrails: readonly Guardrail[], tool: ScopedTool): boolean {
  if (guardrails.length === 0) return true;
  if (!tool.scopeId) return false;
  return guardrails.some((guardrail) => guardrail.scopeId === tool.scopeId);
}

export function assertToolAllowedByGuardrails(agentId: string, guardrails: readonly Guardrail[], tool: ScopedTool): void {
  if (isToolAllowedByGuardrails(guardrails, tool)) return;
  throw new GuardrailViolationError(
    agentId,
    tool.id,
    tool.scopeId
      ? `scope ${tool.scopeId} is not in the agent's guardrail allow-list`
      : 'the tool has no scope and the agent is guardrailed',
  );
}
