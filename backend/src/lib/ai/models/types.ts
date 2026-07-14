import { z } from 'zod';
import { actionIdSchema, type ActionId } from '@/lib/ai/actions/types';
import { providerIdSchema, type ProviderId } from '@/lib/ai/providers/types';

/**
 * Stable INTERNAL model ids in `<vendor>.<model>` dot notation. These never
 * change when a provider renames a deployment — provider-specific external
 * model ids live on each route instead.
 */
export const MODEL_SLUGS = [
  'openai.gpt-5.4-mini',
  'openai.gpt-5.4-nano',
] as const;

export const modelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Model slug must use lowercase dot or hyphen notation');

export type ModelSlug = z.infer<typeof modelSlugSchema>;
export type ModelId = ModelSlug;

export const modelIdSchema = modelSlugSchema;

/** One model exposed through one provider — a separately executable route. */
export interface ModelRoute {
  providerId: ProviderId;
  externalModelId: string;
  enabled: boolean;
}

export const modelRouteSchema = z
  .object({
    providerId: providerIdSchema,
    externalModelId: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

/**
 * Action-specific routing profile — a model performs differently across
 * actions, so there is never a single global quality score. All dimensions
 * are normalized to [0, 1].
 */
export interface ModelActionProfile {
  quality: number;
  speed: number;
  costEfficiency: number;
  reliability: number;
}

const normalizedScore = z.number().min(0).max(1);

export const modelActionProfileSchema = z
  .object({
    quality: normalizedScore,
    speed: normalizedScore,
    costEfficiency: normalizedScore,
    reliability: normalizedScore,
  })
  .strict();

export interface ModelDefinition {
  id: ModelId;
  name: string;

  actions: readonly ActionId[];

  actionProfiles: Partial<Record<ActionId, ModelActionProfile>>;

  routes: readonly ModelRoute[];

  enabled: boolean;
}

export const modelDefinitionSchema = z
  .object({
    id: modelIdSchema,
    name: z.string().min(1),
    actions: z.array(actionIdSchema).min(1),
    actionProfiles: z.record(modelActionProfileSchema),
    routes: z.array(modelRouteSchema).min(1),
    enabled: z.boolean(),
  })
  .strict();
