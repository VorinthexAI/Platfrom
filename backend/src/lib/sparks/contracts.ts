import { z } from 'zod';
import { assertActionSlug, assertDottedSlug } from '@/lib/costs';

const safeIntegerSchema = z.number().int().safe();
const nonzeroSafeIntegerSchema = safeIntegerSchema.refine((value) => value !== 0, 'Must be nonzero.');
const boundedKeySchema = z.string().trim().min(1).max(200);
const requestHashSchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const dottedSlugSchema = z.string().max(200).refine((value) => {
  try { assertDottedSlug(value); return true; } catch { return false; }
}, 'Must be a dotted slug.');
const actionSlugSchema = z.string().max(200).refine((value) => {
  try { assertActionSlug(value); return true; } catch { return false; }
}, 'Must be a canonical action slug.');
const metadataValueSchema = z.union([z.string().max(500), z.boolean(), safeIntegerSchema, z.null()]);

export const sparkTransactionKindSchema = z.enum([
  'account-grant', 'tool', 'action', 'storage', 'recurring-service', 'refund', 'adjustment', 'expiration',
]);

export const sparkMetadataSchema = z.record(z.string().min(1).max(64), metadataValueSchema).superRefine((value, context) => {
  if (Object.keys(value).length > 20) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Metadata is limited to 20 entries.' });
});

const transactionFields = {
  userKey: boundedKeySchema,
  kind: sparkTransactionKindSchema,
  deltaMicroSparks: nonzeroSafeIntegerSchema,
  idempotencyKey: boundedKeySchema,
  requestHash: requestHashSchema,
  eventKey: boundedKeySchema.optional(),
  toolSlug: dottedSlugSchema.optional(),
  actionSlug: actionSlugSchema.optional(),
  metadata: sparkMetadataSchema.optional(),
};

export const sparkTransactionInputSchema = z.object(transactionFields).strict();

export const sparkTransactionSchema = z.object({
  key: boundedKeySchema,
  ...transactionFields,
  balanceAfterMicroSparks: safeIntegerSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const sparkHistoryInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeKey: boundedKeySchema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.beforeCreatedAt === undefined) !== (value.beforeKey === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'beforeCreatedAt and beforeKey must be provided together.' });
});

export type SparkTransactionKind = z.infer<typeof sparkTransactionKindSchema>;
export type SparkMetadata = z.infer<typeof sparkMetadataSchema>;
export type SparkTransactionInput = z.infer<typeof sparkTransactionInputSchema>;
export type SparkTransaction = z.infer<typeof sparkTransactionSchema>;
export type SparkHistoryInput = z.infer<typeof sparkHistoryInputSchema>;
