import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

export const ACTION_SLUGS = [
  'ask', 'chat', 'reason', 'deep-reason', 'embed', 'speak', 'transcribe', 'web-search',
  'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
  'generate-image', 'edit-image', 'generate-video', 'edit-video', 'extend-video', 'analyze-video',
  'generate-speech', 'analyze-audio', 'generate-music', 'orchestrator-chat',
  'document-validate', 'storage-upload', 'document-extract', 'document-generate-html',
  'document-generate-json', 'document-generate-content', 'document-embed', 'document-insert',
] as const;
export type ActionId = (typeof ACTION_SLUGS)[number] | (string & {});
export const actionIdSchema = z.enum(ACTION_SLUGS) as z.ZodType<ActionId> & { options: typeof ACTION_SLUGS };
export function isValidActionIdFormat(id: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(id) && !DOT_NOTATION_PATTERN.test(id);
}
export type ActionModelPolicy = 'required' | 'configurable' | 'none';
export interface ActionModelBinding { provider: string; model: string; priority: number }
export interface ActionDefinition { id: ActionId; modelPolicy: ActionModelPolicy; models: readonly ActionModelBinding[] }
