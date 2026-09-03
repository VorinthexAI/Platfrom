import { z } from 'zod';
import {
  appSearchRetrievalResultSchema, appSearchRetrievalSchema, type AppSearchCollectionSlug, type AppSearchRetrieval, type AppSearchRetrievalResult,
} from '@/lib/app-search/service';

/**
 * Tool-agnostic retrieval capture for conversation turns. Every successful
 * resource tool result — list, search-adjacent, create, update — becomes a
 * query-free `results` retrieval attached to the assistant message, so the
 * client can render the touched resources as navigable results. Deletion
 * tools (the resource no longer exists) and non-resource tools (memberships,
 * invitations, share links, derived artifacts) capture nothing.
 */

const TOOL_RESOURCE_SLUGS: Record<string, AppSearchCollectionSlug> = {
  folder: 'folders', document: 'documents', file: 'files', collection: 'collections', image: 'images', inbox: 'inboxes', trip: 'trips', place: 'places', country: 'countries', book: 'books',
};
const EMAIL_SUB_SLUGS: Record<string, AppSearchCollectionSlug> = { draft: 'email-drafts', tone: 'email-tones', inbox: 'inboxes', message: 'email-messages', thread: 'email-messages' };
const NON_RESOURCE_SEGMENTS = new Set(['member', 'members', 'invite', 'invites', 'share', 'shares', 'memory', 'memories', 'highlight', 'highlights', 'duplicate', 'duplicates', 'topic', 'topics', 'summary', 'summaries', 'version', 'versions', 'audio', 'playback', 'attachment', 'attachments', 'transcript', 'history']);
const DELETE_ACTIONS = new Set(['delete', 'remove', 'discard', 'revoke', 'clear', 'cancel']);
const CONTAINER_FIELD_SLUGS: Record<string, AppSearchCollectionSlug> = {
  folders: 'folders', documents: 'documents', files: 'files', collections: 'collections', images: 'images', inboxes: 'inboxes',
  tones: 'email-tones', drafts: 'email-drafts', messages: 'email-messages', threads: 'email-messages', trips: 'trips', places: 'places', countries: 'countries', books: 'books',
};
const GENERIC_CONTAINER_FIELDS = new Set(['items', 'results']);
const LABEL_FIELDS = ['name', 'title', 'subject', 'filename', 'caption', 'label'] as const;
const FALLBACK_LABELS: Record<AppSearchCollectionSlug, string> = {
  folders: 'Folder', documents: 'Document', files: 'File', collections: 'Collection', images: 'Image', inboxes: 'Inbox',
  'email-tones': 'Email tone', 'email-messages': 'Email message', 'email-drafts': 'Email draft', places: 'Place', trips: 'Trip', countries: 'Country', books: 'Audio book',
};
const MAX_RESULTS_PER_GROUP = 50;

const toolResultEntrySchema = z.object({
  key: z.string().trim().min(1).max(255).optional(),
  countryCode: z.string().trim().min(1).max(255).optional(),
  connectorKey: z.string().trim().min(1).max(255).optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  subject: z.string().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
  label: z.string().optional(),
}).passthrough();

function collectionSlugFor(slug: string): AppSearchCollectionSlug | undefined {
  const segments = slug.split('.');
  if (segments.length < 2) return undefined;
  if (DELETE_ACTIONS.has(segments.at(-1)!)) return undefined;
  if (segments.slice(1).some((segment) => NON_RESOURCE_SEGMENTS.has(segment))) return undefined;
  const [head, sub] = segments as [string, string | undefined];
  if (head === 'email') return sub ? EMAIL_SUB_SLUGS[sub] : undefined;
  return TOOL_RESOURCE_SLUGS[head];
}

function keyField(collectionSlug: AppSearchCollectionSlug) {
  return collectionSlug === 'countries' ? 'countryCode' : 'key';
}

function resultLabel(collectionSlug: AppSearchCollectionSlug, entry: z.infer<typeof toolResultEntrySchema>) {
  const source = LABEL_FIELDS.map((field) => entry[field]).find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
  return source?.trim().slice(0, 200) || FALLBACK_LABELS[collectionSlug];
}

function toResult(collectionSlug: AppSearchCollectionSlug, entry: z.infer<typeof toolResultEntrySchema>): AppSearchRetrievalResult | undefined {
  const key = entry[keyField(collectionSlug)];
  if (typeof key !== 'string' || !key.trim()) return undefined;
  const parsed = appSearchRetrievalResultSchema.safeParse({
    key,
    label: resultLabel(collectionSlug, entry),
    ...(collectionSlug !== 'inboxes' && collectionSlug !== 'email-messages' && collectionSlug !== 'email-drafts' ? {} : typeof entry.connectorKey === 'string' && entry.connectorKey ? { destinationKey: entry.connectorKey } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

function collectEntries(collectionSlug: AppSearchCollectionSlug, rawResult: unknown, entries: Record<string, unknown>[], depth = 0) {
  if (entries.length >= MAX_RESULTS_PER_GROUP || depth > 3) return;
  if (Array.isArray(rawResult)) {
    for (const item of rawResult) {
      if (entries.length >= MAX_RESULTS_PER_GROUP) return;
      if (item && typeof item === 'object' && !Array.isArray(item)) entries.push(item as Record<string, unknown>);
    }
    return;
  }
  if (!rawResult || typeof rawResult !== 'object') return;
  const record = rawResult as Record<string, unknown>;
  if (typeof record[keyField(collectionSlug)] === 'string') {
    entries.push(record);
    return;
  }
  for (const [field, value] of Object.entries(record)) {
    if (CONTAINER_FIELD_SLUGS[field] === collectionSlug || GENERIC_CONTAINER_FIELDS.has(field)) collectEntries(collectionSlug, value, entries, depth + 1);
  }
}

export function projectToolResultRetrieval(slug: string, rawResult: unknown): AppSearchRetrieval | null {
  const collectionSlug = collectionSlugFor(slug);
  if (!collectionSlug) return null;
  const entries: Record<string, unknown>[] = [];
  collectEntries(collectionSlug, rawResult, entries);
  const seen = new Set<string>();
  const results: AppSearchRetrievalResult[] = [];
  for (const entry of entries) {
    const result = toResult(collectionSlug, toolResultEntrySchema.safeParse(entry).data ?? {});
    if (!result || seen.has(result.key)) continue;
    seen.add(result.key);
    results.push(result);
    if (results.length >= MAX_RESULTS_PER_GROUP) break;
  }
  if (!results.length) return null;
  const connectorKeys = [...new Set(entries.map((entry) => (typeof entry.connectorKey === 'string' ? entry.connectorKey : '')).filter(Boolean))] as string[];
  return appSearchRetrievalSchema.parse({
    source: 'results',
    limit: 10,
    minimumScore: 0.55,
    groups: [{ collectionSlug, results }],
    ...(collectionSlug === 'email-messages' || collectionSlug === 'email-drafts' ? { filters: { connectorKey: connectorKeys[0] } } : {}),
  });
}
