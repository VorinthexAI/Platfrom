import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { WORKSPACE_SEARCH_VIEW, WORKSPACE_SEARCH_FIELDS } from './graph-view';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';

const searchableFields = [...new Set(Object.values(WORKSPACE_SEARCH_FIELDS).flat())];
const searchExpression = searchableFields.map((field) => `PHRASE(resource.${field}, @text)`).join(' OR ');

export type GraphHit = { source: keyof typeof WORKSPACE_SEARCH_FIELDS; key: string; label: string; parentKey?: string };

export async function findWorkspaceGraph(text: string, context: ToolContext, limit = 20, dependencies: { database?: Pick<typeof db, 'query'> } = {}): Promise<GraphHit[]> {
  if (context.principal.kind !== 'member' || context.principal.user.key !== contextUserKey(context)) throw new Error('Active user required.');
  const userKey = contextUserKey(context);
  const cursor = await (dependencies.database ?? db).query<{ source: string; document: Record<string, unknown> }>(`
    FOR resource IN ${WORKSPACE_SEARCH_VIEW}
      SEARCH ANALYZER(resource.scopeKey IN @scopeKeys, "identity") AND ANALYZER(resource.userKey IN @userKeys, "identity") AND ANALYZER(${searchExpression}, "text_en")
      OPTIONS { waitForSync: true }
      LET source = PARSE_IDENTIFIER(resource).collection
      FILTER resource.scopeKey == @scopeKey && resource.userKey == @userKey
      FILTER resource.isHidden != true
      LET scope = DOCUMENT(scopes, @scopeKey)
      FILTER scope != null && scope.userKey == @userKey
      SORT BM25(resource) DESC
      LIMIT @limit
      RETURN { source, document: KEEP(resource, "_key", "name", "parentFolderKey", "folderKey") }
  `, { text: text.trim().slice(0, 500), scopeKey: context.runtimeScopeKey, scopeKeys: [context.runtimeScopeKey], userKey, userKeys: [userKey], limit: Math.max(1, Math.min(50, limit)) });
  return (await cursor.all()).flatMap(({ source, document }) => {
    if (!(source in WORKSPACE_SEARCH_FIELDS)) return [];
    const item = withArangoKey(document);
    const parentKey = source === 'files' && typeof item.folderKey === 'string' ? item.folderKey : source === 'folders' && typeof item.parentFolderKey === 'string' ? item.parentFolderKey : undefined;
    return [{ source: source as GraphHit['source'], key: item.key, label: String(item.name ?? source).slice(0, 200), ...(typeof parentKey === 'string' ? { parentKey } : {}) }];
  });
}
