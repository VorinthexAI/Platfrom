import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';

/** V1 guardrails carry only the effective persisted scope key. */
export const guardrailSchema = z.object({
  scopeId: z.string().cuid(),
}).strict();

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

/** Scoped tools must match the allow-list; globally unscoped tools stay reusable. */
export function isToolAllowedByGuardrails(guardrails: readonly Guardrail[], tool: ScopedTool): boolean {
  if (guardrails.length === 0 || !tool.scopeId) return true;
  return guardrails.some((guardrail) => guardrail.scopeId === tool.scopeId);
}

export function assertToolAllowedByGuardrails(agentId: string, guardrails: readonly Guardrail[], tool: ScopedTool): void {
  if (isToolAllowedByGuardrails(guardrails, tool)) return;
  throw new GuardrailViolationError(
    agentId,
    tool.id,
    `scope ${tool.scopeId} is not in the agent's guardrail allow-list`,
  );
}
