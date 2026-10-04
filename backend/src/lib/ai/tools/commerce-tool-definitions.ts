import { z } from 'zod';
import { checkoutCreateInputSchema, subscriptionMutationInputSchema } from '@/lib/commerce/contracts';
import { commerceService, subscriptionScheduleInputSchema } from '@/lib/commerce/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { PublicToolDependencies } from './tool-definition';

const emptySchema = z.object({}).strict();
const checkoutRequestKeySchema = z.string().trim().min(1).max(200);

function authenticatedUserKey({ context }: PublicToolDependencies) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey || principal.userTeam.userId !== principal.user.key) {
    throw new Error('Active authenticated membership is required for commerce operations.');
  }
  return principal.user.key;
}

function definition<Input extends z.ZodTypeAny>(name: string, description: string, inputSchema: Input, readOnly: boolean, execute: (input: z.output<Input>, dependencies: PublicToolDependencies) => Promise<unknown>) {
  return {
    name,
    inputSchema,
    providerDefinition: { name, description, inputSchema: contentZodToJsonSchema(inputSchema) },
    isReadOnly: () => readOnly,
    async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
      return execute(inputSchema.parse(rawInput) as z.output<Input>, dependencies);
    },
  };
}

export const COMMERCE_TOOL_DEFINITIONS = Object.freeze([
  definition('catalog.list', 'List active purchasable plans and Spark top-ups.', emptySchema, true, async () => commerceService.listProducts()),
  definition('payment.checkout.create', 'Create a hosted checkout for an active catalog product.', checkoutCreateInputSchema, false, async (input, dependencies) => commerceService.createCheckout(input, authenticatedUserKey(dependencies), checkoutRequestKeySchema.parse(dependencies.requestKey))),
  definition('subscription.current.read', 'Read the authenticated user\'s current subscription.', emptySchema, true, async (_input, dependencies) => commerceService.getCurrentSubscription(authenticatedUserKey(dependencies))),
  definition('subscription.current.cancel', 'Schedule the authenticated user\'s current subscription to cancel at period end.', subscriptionMutationInputSchema, false, async (_input, dependencies) => commerceService.setCancellation(authenticatedUserKey(dependencies), true)),
  definition('subscription.current.restore', 'Restore a subscription scheduled to cancel at period end.', subscriptionMutationInputSchema, false, async (_input, dependencies) => commerceService.setCancellation(authenticatedUserKey(dependencies), false)),
  definition('subscription.current.schedule', 'Schedule a different active subscription plan for the next renewal.', subscriptionScheduleInputSchema, false, async (input, dependencies) => commerceService.scheduleSubscriptionProduct(authenticatedUserKey(dependencies), input)),
]);
