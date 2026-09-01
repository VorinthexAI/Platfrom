import { contentZodToJsonSchema } from './content-json-schema';
import { assistantQueryInputSchema } from '@/lib/conversations/schemas';

export const assistantQueryToolContract = Object.freeze({
  name: 'assistant.query',
  description: 'Retrieve semantically relevant completed assistant answers from this conversation only. Use only when the current question depends on prior conversation context.',
  inputSchema: assistantQueryInputSchema,
  providerDefinition: Object.freeze({
    name: 'assistant.query',
    description: 'Retrieve semantically relevant completed assistant answers from this conversation only. Use only when the current question depends on prior conversation context.',
    inputSchema: contentZodToJsonSchema(assistantQueryInputSchema),
  }),
});

export async function executeAssistantQueryAdapter(raw: unknown, trusted: { currentConversationKey?: string; query: (conversationKey: string, input: unknown) => Promise<unknown> }) {
  if (!trusted.currentConversationKey) throw new Error('assistant.query requires trusted current conversation context.');
  return trusted.query(trusted.currentConversationKey, assistantQueryInputSchema.parse(raw));
}
