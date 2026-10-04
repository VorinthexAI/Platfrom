import { getDefaultTicketService, ticketIdempotencyKeySchema, ticketListInputSchema, ticketSubmitInputSchema } from '@/lib/tickets/service';
import { contentZodToJsonSchema } from './content-json-schema';
import type { PublicToolDependencies } from './tool-definition';

export const ticketCreateToolDefinition = {
  name: 'ticket.create',
  inputSchema: ticketSubmitInputSchema,
  providerDefinition: {
    name: 'ticket.create',
    description: 'Submit an issue or product-feedback ticket for the authenticated user in the current scope.',
    inputSchema: contentZodToJsonSchema(ticketSubmitInputSchema),
  },
  isReadOnly: () => false,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    const input = ticketSubmitInputSchema.parse(rawInput);
    const requestKey = ticketIdempotencyKeySchema.parse(dependencies.requestKey);
    return getDefaultTicketService().submit(input, dependencies.context, requestKey);
  },
};

export const ticketListToolDefinition = {
  name: 'ticket.list',
  inputSchema: ticketListInputSchema,
  providerDefinition: {
    name: 'ticket.list',
    description: 'List the authenticated user\'s issue and feedback tickets in the current scope.',
    inputSchema: contentZodToJsonSchema(ticketListInputSchema),
  },
  isReadOnly: () => true,
  async execute(rawInput: unknown, dependencies: PublicToolDependencies) {
    return getDefaultTicketService().list(ticketListInputSchema.parse(rawInput), dependencies.context);
  },
};
