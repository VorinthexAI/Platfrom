import { appSearchRetrievalSchema, type AppSearchCollectionSlug, type AppSearchRetrieval } from '@/lib/app-search/service';

const TOOL_RESOURCE_SLUGS: Record<string, AppSearchCollectionSlug> = { folder: 'folders', file: 'files' };

export function captureToolRetrieval(name: string, result: unknown): AppSearchRetrieval | null {
  const root = name.split('.')[0] ?? '';
  const slug = TOOL_RESOURCE_SLUGS[root];
  if (!slug || !result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const rows = [
    record.folder, record.file,
    ...(Array.isArray(record.folders) ? record.folders : []),
    ...(Array.isArray(record.files) ? record.files : []),
    ...(Array.isArray(record.results) ? record.results : []),
  ].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object');
  const results = rows.flatMap((row) => {
    const key = typeof row.key === 'string' ? row.key : undefined;
    const label = typeof row.name === 'string' ? row.name : undefined;
    return key && label ? [{ key, label: label.slice(0, 200) }] : [];
  }).slice(0, 50);
  const parsed = appSearchRetrievalSchema.safeParse({ source: 'results', limit: 10, groups: [{ collectionSlug: slug, results }] });
  return parsed.success && results.length ? parsed.data : null;
}

export const projectToolResultRetrieval = captureToolRetrieval;
