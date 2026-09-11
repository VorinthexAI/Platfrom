import { createHash } from 'node:crypto';

export const INITIAL_WORKSPACE_FOLDER_IDS = ['platform', 'assistant', 'knowledge', 'media', 'communication', 'travel', 'learning'] as const;
export const INITIAL_WORKSPACE_DOCUMENT_IDS = [
  'platform-welcome', 'platform-purpose', 'platform-connections',
  'assistant-overview', 'assistant-purpose', 'assistant-start',
  'knowledge-overview', 'knowledge-purpose', 'knowledge-start',
  'media-overview', 'media-purpose', 'media-start',
  'communication-overview', 'communication-purpose', 'communication-start',
  'travel-overview', 'travel-purpose', 'travel-start',
  'learning-overview', 'learning-purpose', 'learning-start',
] as const;

const stableKey = (kind: string, scopeKey: string, id: string) => `c${createHash('sha256').update(`${kind}\0${scopeKey}\0${id}`).digest('hex').slice(0, 24)}`;

export const initialWorkspaceFolderKey = (scopeKey: string, id: string) => stableKey('initial-folder', scopeKey, id);
export const initialWorkspaceDocumentKey = (scopeKey: string, id: string) => stableKey('initial-document', scopeKey, id);
export const initialWorkspaceBookKey = (scopeKey: string) => stableKey('initial-book', scopeKey, 'vorinthex-ai');
export const initialWorkspaceBookChapterKey = (scopeKey: string, guideId: string) => stableKey('initial-book-chapter', scopeKey, guideId);

export function isInitialWorkspaceFolderKey(scopeKey: string, key: string): boolean {
  return INITIAL_WORKSPACE_FOLDER_IDS.some((id) => initialWorkspaceFolderKey(scopeKey, id) === key);
}

export function isInitialWorkspaceDocumentKey(scopeKey: string, key: string): boolean {
  return INITIAL_WORKSPACE_DOCUMENT_IDS.some((id) => initialWorkspaceDocumentKey(scopeKey, id) === key);
}
