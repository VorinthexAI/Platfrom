import { analyzeAudioAction } from './analyze-audio';
import { analyzeVideoAction } from './analyze-video';
import { captionImageAction } from './caption-image';
import { askAction } from './ask';
import { describeVisualIdentityAction } from './describe-visual-identity';
import { deleteActionDefinition } from './delete';
import { documentEmbedAction } from './document-embed';
import { documentExtractAction } from './document-extract';
import { documentInsertAction } from './document-insert';
import { documentValidateAction } from './document-validate';
import { editImageAction } from './edit-image';
import { editVideoAction } from './edit-video';
import { embedAction } from './embed';
import { extendVideoAction } from './extend-video';
import { generateImageAction } from './generate-image';
import { generateMusicAction } from './generate-music';
import { generateVideoAction } from './generate-video';
import { insertActionDefinition } from './insert';
import { readAction } from './read';
import { storageUploadAction } from './storage-upload';
import { traverseAction } from './traverse';
import { ACTION_SLUGS, actionIdSchema, isValidActionIdFormat, type ActionDefinition, type ActionId } from './types';
import { updateActionDefinition } from './update';
import { upsertAction } from './upsert';
import { webSearchAction } from './web-search';

export type { ActionDefinition, ActionId, ActionModelBinding, ActionModelPolicy } from './types';
export { analyzeAudioAction } from './analyze-audio';
export { analyzeVideoAction } from './analyze-video';
export { captionImageAction } from './caption-image';
export { askAction } from './ask';
export { describeVisualIdentityAction } from './describe-visual-identity';
export { deleteActionDefinition } from './delete';
export { documentEmbedAction } from './document-embed';
export { documentExtractAction } from './document-extract';
export { documentInsertAction } from './document-insert';
export { documentValidateAction } from './document-validate';
export { editImageAction } from './edit-image';
export { editVideoAction } from './edit-video';
export { embedAction } from './embed';
export { extendVideoAction } from './extend-video';
export { generateImageAction } from './generate-image';
export { generateMusicAction } from './generate-music';
export { generateVideoAction } from './generate-video';
export { insertActionDefinition } from './insert';
export { readAction } from './read';
export { storageUploadAction } from './storage-upload';
export { traverseAction } from './traverse';
export { updateActionDefinition } from './update';
export { upsertAction } from './upsert';
export { webSearchAction } from './web-search';
export { ACTION_SLUGS, actionIdSchema, isValidActionIdFormat } from './types';
export { createDataActions, traverseInputSchema, traverseNodes, type ActionNode, type TraverseInput } from './data';
export { coreChatContentSchema, coreChatMessageSchema, coreChatToolDefinitionSchema, coreChatInputSchema, type CoreChatContent, type CoreChatMessage, type CoreChatToolDefinition, type CoreChatInput, type ParsedCoreChatInput } from './core-chat';
export { webSearchInputSchema, webSearchOutputSchema, type WebSearchInput, type ParsedWebSearchInput, type WebSearchOutput } from './web-search';

/** Stable, provider- and domain-neutral runtime primitives. */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  askAction, embedAction, webSearchAction,
  traverseAction, readAction, insertActionDefinition, upsertAction, updateActionDefinition, deleteActionDefinition,
  generateImageAction, editImageAction, generateVideoAction, editVideoAction, extendVideoAction, analyzeVideoAction,
  analyzeAudioAction, generateMusicAction,
  documentValidateAction, storageUploadAction, documentExtractAction, documentEmbedAction, documentInsertAction, captionImageAction, describeVisualIdentityAction,
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
  }
}
