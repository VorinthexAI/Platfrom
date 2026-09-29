import { appSearchRetrievalSchema, searchFiles, type AppSearchRetrieval } from '@/lib/app-search/service';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { agentQueryInputSchema } from './workspace-query-schema';

export { agentQueryInputSchema } from './workspace-query-schema';
export type { AgentQueryInput } from './workspace-query-schema';

export interface WorkspaceQueryDependencies {
  message?: string;
  recent?: AppSearchRetrieval[];
  onEvidence?: (values: AppSearchRetrieval[]) => void;
  signal?: AbortSignal;
}

export async function queryWorkspace(raw: unknown, context: ToolContext, dependencies: WorkspaceQueryDependencies = {}) {
  const input = agentQueryInputSchema.parse(raw);
  if (context.principal.kind !== 'member' || context.principal.user.key !== context.userKey) throw new Error('Active user required.');
  const navigation: AppSearchRetrieval[] = [];
  const answers = [];
  for (const request of input.requests) {
    const slugs = request.resource === 'folders' ? ['folders' as const] : request.resource === 'files' ? ['files' as const] : ['folders' as const, 'files' as const];
    const operation = request.operation === 'count' || request.operation === 'sum' ? 'count' as const : request.operation === 'list' ? 'list' as const : 'search' as const;
    const result = await searchFiles(context, { query: request.query, operation, collectionSlugs: slugs, limit: request.limit });
    answers.push({ operation: request.operation, resource: request.resource, result });
    for (const group of result.groups) {
      const rows = (group.results ?? []) as Array<{ key?: string; name?: string }>;
      const retrievals = rows.filter((row) => typeof row.key === 'string' && typeof row.name === 'string').slice(0, 4).map((row) => ({ key: row.key!, label: String(row.name).slice(0, 200) }));
      if (!retrievals.length) continue;
      const parsed = appSearchRetrievalSchema.safeParse({ source: 'results', limit: 10, groups: [{ collectionSlug: group.collectionSlug, results: retrievals }] });
      if (parsed.success) navigation.push(parsed.data);
    }
  }
  dependencies.onEvidence?.(navigation.slice(0, 4));
  return { userKey: contextUserKey(context), scopeKey: context.runtimeScopeKey, answers };
}
