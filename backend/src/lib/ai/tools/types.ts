import { z } from 'zod';
import { DOT_NOTATION_PATTERN, isDotNotationId } from '@/lib/ai/shared/ids';

export const TOOL_IDS = [
  'ask.answer',
  'reason.solve',
  'agent.create',
  'artifact.read',
  'image.create',
  'audio.transcribe-file',
  'speech.narrate',
  'organization.member.list',
  'organization.member.read',
  'organization.member.add',
  'organization.member.role.update',
  'organization.member.activate',
  'organization.member.suspend',
  'organization.member.remove',
  'scope.list',
  'scope.read',
  'scope.create',
  'scope.update',
  'scope.move',
  'scope.archive',
  'scope.restore',
  'scope.remove',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export const toolIdSchema = z.enum(TOOL_IDS);

/** Executable tool handlers contain no action/model/provider relation data. */
export interface ToolDefinition { id: ToolId; name: string; description: string; scopeId: string | null }
export const toolDefinitionSchema = z.object({
  id: toolIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  scopeId: z.string().min(1).nullable(),
}).strict();
export function isValidToolIdFormat(id: string) { return DOT_NOTATION_PATTERN.test(id) && isDotNotationId(id); }
