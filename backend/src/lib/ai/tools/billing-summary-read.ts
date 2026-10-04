import { z } from 'zod';
import { sparkHistoryInputSchema, sparkTransactionSchema } from '@/lib/sparks/contracts';
import { sparkService } from '@/lib/sparks/service';
import type { PublicToolDependencies } from './tool-definition';

export const billingSummaryReadInputSchema = z.object({
  ...sparkHistoryInputSchema.innerType().shape,
  scopeKey: z.string().cuid().optional(),
}).strict().superRefine((value, context) => {
  if ((value.beforeCreatedAt === undefined) !== (value.beforeKey === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['beforeKey'], message: 'Both history cursor fields are required together.' });
});
export const billingSummaryReadOutputSchema = z.object({
  microSparkBalance: z.number().int().safe().nonnegative(),
  microSparkDebt: z.number().int().safe().nonnegative(),
  spendingBlocked: z.boolean(),
  aiUsageMicroSparks: z.number().int().safe().nonnegative(),
  storage: z.object({
    bytes: z.string().regex(/^(0|[1-9]\d*)$/),
    estimatedMonthlyMicroSparks: z.string().regex(/^(0|[1-9]\d*)$/),
  }).strict(),
  transactions: z.array(sparkTransactionSchema),
}).strict();

export function createBillingSummaryReadTool(getSummary: typeof sparkService.getSummary = sparkService.getSummary) {
  return {
    name: 'billing.summary.read',
    inputSchema: billingSummaryReadInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'billing.summary.read',
      description: 'Read the authenticated user\'s credit balance, account-wide or authorized-scope storage estimate, refund debt status, and recent immutable billing history.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          beforeCreatedAt: { type: 'string', format: 'date-time' },
          beforeKey: { type: 'string', minLength: 1, maxLength: 200 },
          kind: { type: 'string', enum: ['account-grant', 'referral-reward', 'purchase', 'tool', 'action', 'storage', 'recurring-service', 'refund', 'adjustment', 'expiration'] },
          scopeKey: { type: 'string', description: 'Optional owned scope for the storage estimate; other billing fields remain account-wide.' },
        },
      },
    },
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      const input = billingSummaryReadInputSchema.parse(rawInput);
      const principal = dependencies.context.principal;
      if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.userId !== principal.user.key || principal.userTeam.teamKey !== dependencies.context.teamKey) {
        throw new Error('billing.summary.read requires an active authenticated user membership.');
      }
      const { scopeKey, ...history } = input;
      return billingSummaryReadOutputSchema.parse(await getSummary(principal.user.key, history, scopeKey));
    },
  } as const;
}

export const billingSummaryReadToolDefinition = createBillingSummaryReadTool();
