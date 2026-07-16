import { z } from 'zod';
import { actionIdSchema } from '@/lib/ai/actions/types';
import { modelSlugSchema } from '@/lib/db/models.node';
import { providerSlugSchema } from '@/lib/db/providers.node';

const base = { organizationKey: z.string().cuid(), actionSlug: actionIdSchema };
export const autoRouteRequestSchema = z.object({ mode: z.literal('auto'), ...base }).strict();
export const modelRouteRequestSchema = z.object({ mode: z.literal('model'), ...base, modelSlug: modelSlugSchema }).strict();
export const fixedRouteRequestSchema = z.object({ mode: z.literal('fixed'), ...base, modelSlug: modelSlugSchema, providerSlug: providerSlugSchema }).strict();
export const routeRequestSchema = z.discriminatedUnion('mode', [autoRouteRequestSchema, modelRouteRequestSchema, fixedRouteRequestSchema]);
export type AutoRouteRequest = z.infer<typeof autoRouteRequestSchema>;
export type ModelRouteRequest = z.infer<typeof modelRouteRequestSchema>;
export type FixedRouteRequest = z.infer<typeof fixedRouteRequestSchema>;
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteRequestInput = z.input<typeof routeRequestSchema>;
