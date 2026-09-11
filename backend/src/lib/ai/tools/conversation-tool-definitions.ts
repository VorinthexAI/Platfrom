import { contentZodToJsonSchema } from './content-json-schema';
import type { ToolContext } from './tool-context';
import type { ConversationService } from '@/lib/conversations/service';
import { conversationCreateInputSchema, conversationFavoriteInputSchema, conversationKeyInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationModelSendInputSchema, conversationRenameInputSchema, conversationSearchInputSchema } from '@/lib/conversations/schemas';

type ConversationToolService = ConversationService;
export interface ConversationToolDependencies { context: ToolContext; conversations?: ConversationToolService; requestKey?: string; currentConversationKey?: string; currentReferenceImageKeys?: string[] }
const defaultService = async () => (await import('@/lib/conversations/service')).getDefaultConversationService() as unknown as ConversationToolService;
const build = (name: string, description: string, inputSchema: any, effect: 'read' | 'write', execute: (input: unknown, service: ConversationToolService, dependencies: ConversationToolDependencies) => Promise<unknown>) => ({
  name, inputSchema, providerDefinition: { name, description, inputSchema: contentZodToJsonSchema(inputSchema) },
  isReadOnly: (): boolean => effect === 'read',
  async execute(raw: unknown, dependencies: ConversationToolDependencies) { return execute(inputSchema.parse(raw), dependencies.conversations ?? await defaultService(), dependencies); },
});

export const CONVERSATION_TOOL_DEFINITIONS = Object.freeze([
  build('conversation.create', 'Create a private conversation in the current scope.', conversationCreateInputSchema, 'write', (input, service, deps) => service.create(input, deps.context)),
  build('conversation.list', 'List private conversations, favorites first.', conversationListInputSchema, 'read', (input, service, deps) => service.list(input, deps.context)),
  build('conversation.search', 'Search private conversations by name.', conversationSearchInputSchema, 'read', (input, service, deps) => service.search(input, deps.context)),
  build('conversation.rename', 'Rename a private conversation.', conversationRenameInputSchema, 'write', (input, service, deps) => service.rename(input, deps.context)),
  build('conversation.favorite', 'Set a private conversation favorite state.', conversationFavoriteInputSchema, 'write', (input, service, deps) => service.favorite(input, deps.context)),
  build('conversation.delete', 'Permanently delete a private conversation and its messages.', conversationKeyInputSchema, 'write', (input, service, deps) => service.delete(input, deps.context)),
  build('conversation.message.list', 'List messages in a private conversation.', conversationMessageListInputSchema, 'read', (input, service, deps) => service.messages(input, deps.context)),
  build('conversation.message.delete', 'Permanently delete a private conversation turn containing the selected message.', conversationMessageDeleteInputSchema, 'write', (input, service, deps) => service.deleteMessage(input, deps.context)),
  build('conversation.message.send', 'Send an idempotent user turn and complete its assistant answer.', conversationModelSendInputSchema, 'write', async (input, service, deps) => { if (!deps.requestKey) throw new Error('conversation.message.send requires a trusted request key.'); const events: unknown[] = []; await service.turn({ ...(input as object), requestKey: deps.requestKey }, deps.context, (event) => { events.push(event); }); return events.at(-1); }),
]);
