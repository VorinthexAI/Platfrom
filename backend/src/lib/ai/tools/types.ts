import { z } from 'zod';
import { actionIdSchema, type ActionId } from '@/lib/ai/actions/types';
import { modelIdSchema, type ModelId } from '@/lib/ai/models/types';
import { DOT_NOTATION_PATTERN, isDotNotationId } from '@/lib/ai/shared/ids';
import { routingStrategySchema, type RoutingStrategy } from '@/lib/ai/router/types';

/** Built-in tool ids in `<domain>.<tool>` dot notation. */
export const TOOL_IDS = [
  'ask.answer',
  'reason.solve',
  'image.create',
  'audio.transcribe-file',
  'speech.narrate',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export const toolIdSchema = z.enum(TOOL_IDS);

/**
 * A tool references an ACTION only — never a provider, endpoint, or model
 * configuration. It may carry routing PREFERENCES, but the router remains
 * authoritative and still enforces the organization provider allow-list.
 */
export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  /** The single action this tool performs — the only execution reference a tool holds. */
  actionId: ActionId;
  /** Organization scope this tool operates in; guardrailed agents may only use tools whose scope their guardrails allow. */
  scopeId: string | null;
  /** Optional routing preferences — hints, not commands. */
  routing?: {
    modelId?: ModelId;
    strategy?: RoutingStrategy;
  };
}

export const toolDefinitionSchema = z
  .object({
    id: toolIdSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    actionId: actionIdSchema,
    scopeId: z.string().min(1).nullable(),
    routing: z
      .object({
        modelId: modelIdSchema.optional(),
        strategy: routingStrategySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function isValidToolIdFormat(id: string): boolean {
  return DOT_NOTATION_PATTERN.test(id) && isDotNotationId(id);
}
