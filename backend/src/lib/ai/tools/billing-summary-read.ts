import { z } from 'zod';
import { sparkHistoryInputSchema, sparkTransactionSchema } from '@/lib/sparks/contracts';
import { sparkService } from '@/lib/sparks/service';
import type { PublicToolDependencies } from './tool-definition';

export const billingSummaryReadInputSchema = sparkHistoryInputSchema;
export const billingSummaryReadOutputSchema = z.object({
  microSparkBalance: z.number().int().safe().nonnegative(),
  transactions: z.array(sparkTransactionSchema),
}).strict();

export function createBillingSummaryReadTool(getSummary: typeof sparkService.getSummary = sparkService.getSummary) {
  return {
    name: 'billing.summary.read',
    inputSchema: billingSummaryReadInputSchema,
    isReadOnly: () => true,
    providerDefinition: {
      name: 'billing.summary.read',
      description: 'Read the authenticated user\'s current credit balance and recent immutable billing history.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          beforeCreatedAt: { type: 'string', format: 'date-time' },
          beforeKey: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      const input = billingSummaryReadInputSchema.parse(rawInput);
      const principal = dependencies.context.principal;
      if (principal.kind !== 'member' || principal.userOrganization.status !== 'active' || principal.userOrganization.userId !== principal.user.key || principal.userOrganization.organizationId !== dependencies.context.organizationKey) {
        throw new Error('billing.summary.read requires an active authenticated user membership.');
      }
      return billingSummaryReadOutputSchema.parse(await getSummary(principal.user.key, input));
    },
  } as const;
}

export const billingSummaryReadToolDefinition = createBillingSummaryReadTool();
