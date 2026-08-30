import { deleteActionDefinition } from './delete';
import { embedAction } from './embed';
import { insertActionDefinition } from './insert';
import { readAction } from './read';
import { traverseAction } from './traverse';
import { ACTION_SLUGS, actionIdSchema, isValidActionIdFormat, type ActionDefinition, type ActionId } from './types';
import { updateActionDefinition } from './update';
import { upsertAction } from './upsert';
import { textAction } from './text';
import { imageAction } from './image';
import { speechAction } from './speech';
import { webAction } from './web';
import { fileAction } from './file';
import { uploadAction } from './upload';
import { queueAction } from './queue';

export type { ActionDefinition, ActionId, ActionModelBinding, ActionModelPolicy, ActionRouteId, ActionRouteSuffix } from './types';
export { deleteActionDefinition } from './delete';
export { embedAction } from './embed';
export { insertActionDefinition } from './insert';
export { readAction } from './read';
export { traverseAction } from './traverse';
export { updateActionDefinition } from './update';
export { upsertAction } from './upsert';
export { textAction } from './text';
export { imageAction } from './image';
export { speechAction, speechInputSchema, speechOutputSchema, type SpeechInput, type SpeechOutput } from './speech';
export { webAction, webInputSchema, webOutputSchema, type WebInput, type ParsedWebInput, type WebOutput } from './web';
export { fileAction, fileInputSchema, fileOutputSchema, MAX_FILE_ACTION_BYTES, MAX_FILE_ACTION_TEXT_CHARACTERS, type FileInput, type FileOutput } from './file';
export { uploadAction } from './upload';
export { queueAction, executeQueueAction, type QueueActionInput } from './queue';
export { ACTION_ROUTE_SUFFIXES, ACTION_SLUGS, actionIdSchema, isValidActionIdFormat } from './types';
export { createDataActions, traverseInputSchema, traverseNodes, type ActionNode, type TraverseInput } from './data';
export { coreChatContentSchema, coreChatMessageSchema, coreChatToolDefinitionSchema, coreChatInputSchema, type CoreChatContent, type CoreChatMessage, type CoreChatToolDefinition, type CoreChatInput, type ParsedCoreChatInput } from './core-chat';

/** Stable, provider- and domain-neutral runtime primitives. */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  textAction, webAction, imageAction, speechAction, embedAction, fileAction, uploadAction, queueAction,
  traverseAction, readAction, insertActionDefinition, upsertAction, updateActionDefinition, deleteActionDefinition,
];
export const getActionDefinition = (id: ActionId): ActionDefinition | undefined => ACTION_DEFINITIONS.find((definition) => definition.id === id);

export function assertActionRegistryIntegrity(): void {
  if (new Set(ACTION_SLUGS).size !== ACTION_SLUGS.length) {
    throw new Error('ACTION_SLUGS contains duplicate action slugs');
  }
  for (const slug of ACTION_SLUGS) {
    if (!isValidActionIdFormat(slug)) {
      throw new Error(`Action slug does not follow lowercase dot notation: ${slug}`);
    }
  }
  const definitions = new Map(ACTION_DEFINITIONS.map((definition) => [definition.id, definition]));
  if (definitions.size !== ACTION_DEFINITIONS.length || ACTION_SLUGS.some((slug) => !definitions.has(slug))) {
    throw new Error('ACTION_SLUGS and ACTION_DEFINITIONS must define the same unique actions');
  }
  for (const definition of ACTION_DEFINITIONS) {
    if (definition.modelPolicy === 'none' && definition.models.length > 0) throw new Error(`${definition.id} cannot bind models with modelPolicy none`);
    if (definition.modelPolicy === 'required' && definition.models.length === 0) throw new Error(`${definition.id} requires at least one model binding`);
    if (new Set(definition.models.map(({ slot }) => slot)).size !== definition.models.length) throw new Error(`${definition.id} contains duplicate route slots`);
  }
}
