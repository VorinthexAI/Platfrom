import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { WORKSPACE_SEARCH_VIEW, WORKSPACE_SEARCH_FIELDS } from './graph-view';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { evaluateScopeAccess } from '@/lib/ai/tools/domain-access-engine';

const searchableFields = [...new Set(Object.values(WORKSPACE_SEARCH_FIELDS).flat())];
const searchExpression = searchableFields.map((field) => `PHRASE(resource.${field}, @text)`).join(' OR ');
const USER_PRIVATE_SOURCES = ['emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext'] as const;

export type GraphHit = { source: keyof typeof WORKSPACE_SEARCH_FIELDS; key: string; label: string; parentKey?: string; resourceHint?: 'files' };

/** The view is an index over the original documents, not a second copy of them. */
export async function findWorkspaceGraph(text: string, context: ToolContext, limit = 20, dependencies: { database?: Pick<typeof db, 'query'>; authorize?: typeof evaluateScopeAccess } = {}): Promise<GraphHit[]> {
  if (context.principal.kind !== 'member' || context.principal.userTeam.status !== 'active' || context.principal.userTeam.userId !== context.principal.user.key || context.principal.userTeam.teamKey !== context.teamKey) throw new Error('Active membership required.');
  if (!(await (dependencies.authorize ?? evaluateScopeAccess)(context, { scope: context.runtimeScopeKey, action: 'read' })).allowed) throw new Error('Scope access denied.');
  const cursor = await (dependencies.database ?? db).query<{ source: string; document: Record<string, unknown> }>(`
    FOR resource IN ${WORKSPACE_SEARCH_VIEW}
      SEARCH ANALYZER(resource.scopeKey IN @scopeKeys, "identity") AND ANALYZER(${searchExpression}, "text_en")
      OPTIONS { waitForSync: true }
      LET source = PARSE_IDENTIFIER(resource).collection
      FILTER resource.scopeKey == @scopeKey OR (resource.scopeKey == @userKey AND resource.userKey == @userKey AND source IN @privateSources)
      LET scope = DOCUMENT(scopes, @scopeKey)
      FILTER scope != null && scope.teamKey == @teamKey
      SORT BM25(resource) DESC
      LIMIT @limit
      RETURN { source, document: KEEP(resource, "_key", "name", "title", "filename", "subject", "caption", "text", "message", "bookKey", "tripKey", "placeKey", "threadKey", "extension") }
  `, { text: text.trim().slice(0, 500), scopeKey: context.runtimeScopeKey, scopeKeys: [context.runtimeScopeKey, context.principal.user.key], userKey: context.principal.user.key, privateSources: USER_PRIVATE_SOURCES, teamKey: context.teamKey, limit: Math.max(1, Math.min(50, limit)) });
  return (await cursor.all()).flatMap(({ source, document }) => {
    if (!(source in WORKSPACE_SEARCH_FIELDS)) return [];
    const item = withArangoKey(document);
    const parentKey = source === 'bookChapters' ? item.bookKey : source === 'tripGuides' ? item.tripKey : source === 'placeReferences' ? item.placeKey : undefined;
    const key = source === 'emailMessages' && typeof item.threadKey === 'string' ? item.threadKey : item.key;
    return [{ source: source as GraphHit['source'], key, label: String(item.name ?? item.title ?? item.filename ?? item.subject ?? item.caption ?? item.text ?? item.message ?? source).slice(0, 200), ...(typeof parentKey === 'string' ? { parentKey } : {}), ...(source === 'documents' && typeof item.extension === 'string' ? { resourceHint: 'files' as const } : {}) }];
  });
}
