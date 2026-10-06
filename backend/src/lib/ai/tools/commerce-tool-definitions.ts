import { z } from 'zod';
import { commerceService } from '@/lib/commerce/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { PublicToolDependencies } from './tool-definition';

const emptySchema = z.object({}).strict();
function userKey({ context }: PublicToolDependencies) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey || principal.userTeam.userId !== principal.user.key) throw new Error('Active membership required.');
  return principal.user.key;
}
export const COMMERCE_TOOL_DEFINITIONS = Object.freeze([
  { name: 'catalog.list', inputSchema: emptySchema, providerDefinition: { name: 'catalog.list', description: 'List available subscriptions and Spark top-ups.', inputSchema: contentZodToJsonSchema(emptySchema) }, isReadOnly: () => true, execute: async (input: unknown) => { emptySchema.parse(input); return commerceService.listProducts(); } },
  { name: 'subscription.current.read', inputSchema: emptySchema, providerDefinition: { name: 'subscription.current.read', description: 'Read the current subscription.', inputSchema: contentZodToJsonSchema(emptySchema) }, isReadOnly: () => true, execute: async (input: unknown, dependencies: PublicToolDependencies) => { emptySchema.parse(input); return commerceService.getCurrentSubscription(userKey(dependencies)); } },
]);
