import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

export const ACTION_SLUGS = [
  'ask', 'embed', 'web-search',
  'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
  'generate-image', 'edit-image', 'generate-video', 'edit-video', 'extend-video', 'analyze-video',
  'analyze-audio', 'generate-music', 'generate-speech',
  'document-validate', 'storage-upload', 'document-extract', 'document-embed', 'document-insert', 'caption-image', 'describe-visual-identity',
] as const;
export type ActionId = (typeof ACTION_SLUGS)[number];
export const actionIdSchema = z.enum(ACTION_SLUGS);
export function isValidActionIdFormat(id: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(id) && !DOT_NOTATION_PATTERN.test(id);
}
export type ActionModelPolicy = 'required' | 'configurable' | 'none';
export interface ActionModelBinding { provider: string; model: string; priority: number }
export interface ActionDefinition { id: ActionId; modelPolicy: ActionModelPolicy; models: readonly ActionModelBinding[] }
