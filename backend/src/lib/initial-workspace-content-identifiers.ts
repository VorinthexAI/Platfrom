export const INITIAL_WORKSPACE_DOCUMENT_IDS = ['assistant-overview', 'assistant-start', 'conversation-history', 'knowledge-overview', 'knowledge-start'] as const;
export function initialWorkspaceFolderKey(_scopeKey: string, _kind?: string) { return undefined; }
export function initialWorkspaceDocumentKey(scopeKey: string, id: string) { return `${scopeKey}:${id}`; }
