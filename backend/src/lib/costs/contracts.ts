import { z } from 'zod';

const chargeBaseSchema = z.object({
  key: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
}).strict();

export const staticSparkChargeSchema = chargeBaseSchema.extend({
  kind: z.literal('static'),
  sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/),
  unit: z.enum(['invocation', 'documents', 'images', 'new-email']),
}).strict();

export const storageSparkChargeSchema = chargeBaseSchema.extend({
  kind: z.literal('storage'),
  sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/),
  unit: z.literal('gb-month'),
}).strict();

export const variableSparkChargeSchema = chargeBaseSchema.extend({
  kind: z.literal('variable'),
}).strict();

export const publicSparkChargeSchema = z.discriminatedUnion('kind', [staticSparkChargeSchema, storageSparkChargeSchema, variableSparkChargeSchema]);
export const capabilitySparkCostSchema = z.object({ sparkCost: z.string().regex(/^[1-9]\d*(?:\.\d{1,6})?$/), microSparkCost: z.number().int().safe().positive(), unit: z.literal('invocation') }).strict();
export const publicSparkCostsSchema = z.object({
  charges: z.array(publicSparkChargeSchema).max(100),
  capabilityCosts: z.record(z.string(), capabilitySparkCostSchema),
}).strict();

export type PublicSparkCosts = z.infer<typeof publicSparkCostsSchema>;
