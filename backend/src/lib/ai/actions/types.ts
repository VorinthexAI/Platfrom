import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';
import type { ModelId } from '@/lib/ai/providers/registry';
import type { ProviderSlug } from '@/lib/ai/providers/types';

export const ACTION_SLUGS = [
  'text', 'web', 'image', 'speech', 'embed', 'file', 'upload', 'queue',
  'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
] as const;
export type ActionId = (typeof ACTION_SLUGS)[number];
export const actionIdSchema = z.enum(ACTION_SLUGS);
export function isValidActionIdFormat(id: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(id) && !DOT_NOTATION_PATTERN.test(id);
}
export type ActionModelPolicy = 'required' | 'configurable' | 'none';
export const ACTION_ROUTE_SUFFIXES = ['primary', 'secondary', 'tertiary', 'fallback-01', 'fallback-02', 'fallback-03', 'fallback-04', 'fallback-05', 'fallback-06', 'fallback-07'] as const;
export type ActionRouteSuffix = (typeof ACTION_ROUTE_SUFFIXES)[number];
export type ActionRouteId = `${ActionId}.${ActionRouteSuffix}`;
export interface ActionModelBinding { slot: ActionRouteSuffix; provider: ProviderSlug; model: ModelId; priority: number }
export interface ActionDefinition { id: ActionId; modelPolicy: ActionModelPolicy; models: readonly ActionModelBinding[] }
