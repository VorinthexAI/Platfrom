import { z } from 'zod';
import { actionIdSchema } from '@/lib/ai/actions/types';
import { modelIdSchema } from '@/lib/ai/models/types';
import { providerIdSchema } from '@/lib/ai/providers/types';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { routingStrategySchema } from './types';

/** `auto`: the router selects both model and provider. */
export const autoRouteRequestSchema = z
  .object({
    mode: z.literal('auto'),
    organizationId: organizationIdSchema,
    actionId: actionIdSchema,
    /** Free-text intent, reserved for future objective-aware routing — v1 scoring ignores it. */
    objective: z.string().optional(),
    strategy: routingStrategySchema.default('balanced'),
  })
  .strict();

/** `model`: the model is fixed, the provider is selected automatically. */
export const modelRouteRequestSchema = z
  .object({
    mode: z.literal('model'),
    organizationId: organizationIdSchema,
    actionId: actionIdSchema,
    modelId: modelIdSchema,
    objective: z.string().optional(),
    strategy: routingStrategySchema.default('balanced'),
  })
  .strict();

/** `fixed`: both model and provider are fixed. No fallback unless explicitly allowed. */
export const fixedRouteRequestSchema = z
  .object({
    mode: z.literal('fixed'),
    organizationId: organizationIdSchema,
    actionId: actionIdSchema,
    modelId: modelIdSchema,
    providerId: providerIdSchema,
    /** Explicit opt-in: without this a fixed route NEVER silently changes provider. */
    allowFallback: z.boolean().default(false),
  })
  .strict();

export const routeRequestSchema = z.discriminatedUnion('mode', [
  autoRouteRequestSchema,
  modelRouteRequestSchema,
  fixedRouteRequestSchema,
]);

export type AutoRouteRequest = z.infer<typeof autoRouteRequestSchema>;
export type ModelRouteRequest = z.infer<typeof modelRouteRequestSchema>;
export type FixedRouteRequest = z.infer<typeof fixedRouteRequestSchema>;
export type RouteRequest = z.infer<typeof routeRequestSchema>;

/** The pre-parse (input) shape callers may pass — defaults not yet applied. */
export type RouteRequestInput = z.input<typeof routeRequestSchema>;
