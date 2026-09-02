import { contentZodToJsonSchema } from './content-json-schema';
import { agentQueryInputSchema } from '@/lib/conversations/schemas';

const description = 'Semantically search completed private messages across the authenticated user\'s conversations in the current organization and scope. Use only when context beyond the supplied recent messages is needed.';

export const agentQueryToolContract = Object.freeze({
  name: 'agent.query',
  description,
  inputSchema: agentQueryInputSchema,
  providerDefinition: Object.freeze({
    name: 'agent.query',
    description,
    inputSchema: contentZodToJsonSchema(agentQueryInputSchema),
  }),
});

export async function executeAgentQueryAdapter(raw: unknown, trusted: { query: (input: unknown) => Promise<unknown> }) {
  return trusted.query(agentQueryInputSchema.parse(raw));
}
