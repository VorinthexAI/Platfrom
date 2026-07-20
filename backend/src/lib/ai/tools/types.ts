import { z } from 'zod';
import { DOT_NOTATION_PATTERN, isDotNotationId } from '@/lib/ai/shared/ids';

/** Tool execution is disabled. Actions remain as dormant metadata only. */
export const TOOL_IDS = [] as const;
export type ToolId = string;
export const toolIdSchema = z.string().trim().min(1);

/** Executable tool handlers contain no action/model/provider relation data. */
export interface ToolDefinition { id: ToolId; name: string; description: string; scopeId: string | null }
export const toolDefinitionSchema = z.object({
  id: toolIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  scopeId: z.string().min(1).nullable(),
}).strict();
export function isValidToolIdFormat(id: string) { return DOT_NOTATION_PATTERN.test(id) && isDotNotationId(id); }
