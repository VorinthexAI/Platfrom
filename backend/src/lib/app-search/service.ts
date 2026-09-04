import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import type { EmbeddingInput, EmbeddingOutput } from '@/lib/ai/providers';
import { currentEmbeddingSchema, prepareEmbeddingText } from '@/lib/embeddings';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { ContentError } from '@/lib/ai/tools/content-errors';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { galleryOperations, searchGalleryCollections, type GalleryOperationContext } from '@/lib/gallery/operations';
import { createEmailService, type EmailService } from '@/lib/email-inbox/service';
import { emailAttachmentRefsSchema } from '@/lib/email-inbox/archive-payloads';
import { createTravelService, travelPlaceSearchResultSchema, travelTripSchema, type TravelService } from '@/lib/travel/service';
import { createCountrySearchService, type CountrySearchService } from '@/lib/travel/country-search';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { defaultBookService } from '@/lib/books/default-service';
import type { BookService } from '@/lib/books/service';
import { getDefaultScopeTagRepository, type ScopeTagRepository, type ScopeTagTarget } from '@/lib/scope-tags/repository';
import { createScopeTagService, normalizeScopeTagName, ScopeTagError } from '@/lib/scope-tags/service';

export const appSearchCollectionSlugSchema = z.enum([
  'folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places', 'trips', 'countries', 'books', 'tags', 'tag-assignments',
]);
export type AppSearchCollectionSlug = z.infer<typeof appSearchCollectionSlugSchema>;

export const appSearchOperationSchema = z.enum(['search', 'list', 'count', 'sum', 'get', 'summarize']);
type AppSearchOperation = z.infer<typeof appSearchOperationSchema>;
export const appSearchSumFieldSchema = z.enum(['sizeBytes', 'estimatedMinutes', 'chapterCount']);
type AppSearchSumField = z.infer<typeof appSearchSumFieldSchema>;
type AppSearchSumFieldMetadata = { description: string; unit: 'bytes' | 'minutes' | 'chapters' };
type AppSearchFilterName = 'folderKey' | 'includeDescendants' | 'collectionKey' | 'connectorKey' | 'readState' | 'emailFacets' | 'status' | 'isFavorite' | 'createdFrom' | 'createdTo' | 'tagNames' | 'tagKeys' | 'tagMatch' | 'targetTypes';
type AppSearchCollectionAdapter = { description: string; operations: readonly AppSearchOperation[]; filters: readonly AppSearchFilterName[]; fields: readonly string[]; sumFields?: Partial<Record<AppSearchSumField, AppSearchSumFieldMetadata>>; statuses?: readonly string[] };
export const APP_SEARCH_COLLECTION_ADAPTERS = Object.freeze({
  folders: { description: 'Containers that organize saved documents and files; searched by folder name and description.', operations: ['search', 'list', 'count', 'get'], filters: ['folderKey', 'includeDescendants', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'scopeKey', 'name', 'description', 'parentFolderKey', 'isFavorite', 'createdAt', 'updatedAt', 'tags'] },
  documents: { description: 'Saved text notes and readable documents without a file extension; searched by title and content.', operations: ['search', 'list', 'count', 'sum', 'get', 'summarize'], filters: ['folderKey', 'includeDescendants', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'scopeKey', 'name', 'folderKey', 'folder', 'extension', 'mimeType', 'sizeBytes', 'isFavorite', 'content', 'createdAt', 'updatedAt', 'tags'], sumFields: { sizeBytes: { description: 'Bytes used by stored original files; native notes without an original contribute no value.', unit: 'bytes' } } },
  files: { description: 'Uploaded or stored files with a file extension; searched by filename and extracted readable content.', operations: ['search', 'list', 'count', 'sum', 'get', 'summarize'], filters: ['folderKey', 'includeDescendants', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'scopeKey', 'name', 'folderKey', 'folder', 'extension', 'mimeType', 'sizeBytes', 'isFavorite', 'content', 'createdAt', 'updatedAt', 'tags'], sumFields: { sizeBytes: { description: 'Bytes used by stored original files.', unit: 'bytes' } } },
  collections: { description: 'Named Gallery albums that group images; searched by album name and description, not individual image content.', operations: ['search', 'list', 'count', 'get'], filters: ['createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'name', 'description', 'purpose', 'mutationPolicy', 'presentation', 'isFavorite', 'count', 'role', 'isOwned', 'createdAt', 'updatedAt', 'tags'] },
  images: { description: 'Individual pictures and generated visuals; searched by filename, caption, depicted content, place, and visible text.', operations: ['search', 'list', 'count', 'sum'], filters: ['collectionKey', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'filename', 'caption', 'mimeType', 'sizeBytes', 'width', 'height', 'city', 'country', 'countryCode', 'origin', 'isFavorite', 'createdAt', 'updatedAt', 'collections', 'tags'], sumFields: { sizeBytes: { description: 'Bytes used by unique stored images.', unit: 'bytes' } } },
  inboxes: { description: 'Connected email accounts or mailboxes; searched by inbox name, address, and description, not message content.', operations: ['search', 'list', 'count', 'get'], filters: ['createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'connectorKey', 'provider', 'email', 'name', 'description', 'isFavorite', 'status', 'syncEnabled', 'syncStatus', 'lastSyncedAt', 'createdAt', 'updatedAt', 'tags'], statuses: ['active', 'error', 'revoked'] },
  'email-tones': { description: 'Saved writing styles used when composing email; searched by tone name and instruction.', operations: ['search', 'list', 'count'], filters: ['createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'slug', 'name', 'instruction', 'isFavorite', 'createdAt', 'updatedAt', 'tags'] },
  'email-messages': { description: 'Received and sent email conversations; searched by sender, subject, summary, intent, and body.', operations: ['search', 'list', 'count', 'get'], filters: ['connectorKey', 'readState', 'emailFacets', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'subject', 'summary', 'content', 'intent', 'priority', 'state', 'lastMessageAt', 'unread', 'isRead', 'isFavorite', 'inboxCategory', 'createdAt', 'updatedAt', 'tags'] },
  'email-drafts': { description: 'Composed email drafts; searched by recipients, subject, instructions, and draft body.', operations: ['search', 'list', 'count'], filters: ['connectorKey', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'variant', 'connectorKey', 'threadKey', 'messageKey', 'subject', 'to', 'instruction', 'generatedContent', 'finalContent', 'status', 'createdAt', 'updatedAt', 'tags'], statuses: ['generated', 'edited', 'sending', 'sent', 'discarded'] },
  places: { description: 'Personally saved travel destinations with wishlist or visited state; searched by place name and summary.', operations: ['search', 'list', 'count', 'get'], filters: ['status', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'kind', 'name', 'summary', 'countryCode', 'latitude', 'longitude', 'status', 'isFavorite', 'createdAt', 'coverUrl', 'trips', 'tags'], statuses: ['wishlist', 'visited'] },
  trips: { description: 'User-created travel plans containing ordered saved places; searched by trip name and description.', operations: ['search', 'list', 'count', 'get'], filters: ['status', 'isFavorite', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'name', 'description', 'status', 'isFavorite', 'coverImageKey', 'createdAt', 'updatedAt', 'places', 'attachments', 'tags'], statuses: ['planned', 'completed'] },
  countries: { description: 'Global country reference information, not only saved destinations; searched by country name or code.', operations: ['search'], filters: [], fields: ['name', 'countryCode', 'latitude', 'longitude'] },
  books: { description: 'Generated audio books in the user library; searched by title, subtitle, topic, goal, audience, and outcome.', operations: ['search', 'list', 'count', 'sum', 'get'], filters: ['status', 'isFavorite', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], fields: ['key', 'title', 'subtitle', 'description', 'content', 'status', 'isFavorite', 'isExtending', 'narrator', 'estimatedMinutes', 'chapterCount', 'progressPercent', 'createdAt', 'updatedAt', 'tags'], sumFields: { estimatedMinutes: { description: 'Estimated listening duration across books.', unit: 'minutes' }, chapterCount: { description: 'Number of chapters across books.', unit: 'chapters' } }, statuses: ['queued', 'researching', 'planning', 'writing', 'narrating', 'finalizing', 'failed', 'ready', 'cancelled'] },
  tags: { description: 'Private labels owned by the current user in this scope; searched semantically by tag name and description.', operations: ['search', 'list', 'count', 'get'], filters: ['createdFrom', 'createdTo'], fields: ['key', 'name', 'description', 'createdAt', 'updatedAt'] },
  'tag-assignments': { description: 'Private relationships between the current user\'s tags and recognizable authorized workspace resources; use one list with tagNames and tagMatch all to find resources under every named tag.', operations: ['list', 'count', 'get'], filters: ['tagNames', 'tagKeys', 'tagMatch', 'targetTypes'], fields: ['key', 'tag', 'target'] },
} as const satisfies Record<AppSearchCollectionSlug, AppSearchCollectionAdapter>);
export const APP_SEARCH_COLLECTION_OPERATIONS = Object.freeze(Object.fromEntries(Object.entries(APP_SEARCH_COLLECTION_ADAPTERS).map(([slug, adapter]) => [slug, adapter.operations]))) as { readonly [K in AppSearchCollectionSlug]: typeof APP_SEARCH_COLLECTION_ADAPTERS[K]['operations'] };
export function describeAppSearchCollections() {
  return (Object.entries(APP_SEARCH_COLLECTION_ADAPTERS) as Array<[AppSearchCollectionSlug, AppSearchCollectionAdapter]>).map(([slug, adapter]) => {
    const sums = Object.entries(adapter.sumFields ?? {}).map(([field, metadata]) => `${field} (${metadata!.description} Unit: ${metadata!.unit})`).join(', ');
    return `${slug}: ${adapter.description} Operations: ${adapter.operations.join(', ')}. Public fields: ${adapter.fields.join(', ')}.${sums ? ` Summable fields: ${sums}.` : ''}`;
  }).join(' ');
}

const tagNamesSchema = z.array(z.string().transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(1).max(120))).min(1).max(20).superRefine((names, context) => {
  const normalized = names.map(normalizeScopeTagName);
  if (new Set(normalized).size !== normalized.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tag names must be distinct after normalization.' });
}).describe('Exact private tag display names in the current scope. Prefer these names for tag filtering; matching is case-insensitive and NFKC/whitespace normalized.');
const appSearchFiltersShape = {
  folderKey: z.string().cuid().optional(),
  includeDescendants: z.boolean().optional(),
  collectionKey: z.string().cuid().optional(),
  connectorKey: z.string().cuid().optional(),
  readState: z.enum(['read', 'unread']).optional(),
  emailFacets: z.array(z.enum(['urgent', 'important', 'filtered', 'favorite'])).min(1).max(4).superRefine((facets, context) => {
    if (new Set(facets).size !== facets.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Email facets must be distinct.' });
  }).optional(),
  status: z.enum(['active', 'error', 'revoked', 'generated', 'edited', 'sending', 'sent', 'discarded', 'wishlist', 'visited', 'planned', 'completed', 'queued', 'researching', 'planning', 'writing', 'narrating', 'finalizing', 'failed', 'ready', 'cancelled']).optional(),
  isFavorite: z.boolean().optional(),
  createdFrom: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).optional(),
  createdTo: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).optional(),
  tagNames: tagNamesSchema.optional(),
  tagKeys: z.array(z.string().cuid()).min(1).max(20).superRefine((keys, context) => { if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tag keys must be distinct.' }); }).describe('Exact private tag IDs in the current user and scope. Use tagMatch all to require every tag or any to require at least one.').optional(),
  tagMatch: z.enum(['any', 'all']).describe('How multiple tag filters combine: all requires every supplied tag; any requires at least one supplied tag. Defaults to any.').optional(),
  targetTypes: z.array(z.enum(['folder', 'document', 'image-collection', 'image', 'image-highlight', 'image-memory', 'place', 'trip', 'email-inbox', 'email-tone', 'email-thread', 'email-message', 'email-draft', 'book'])).min(1).max(14).superRefine((types, context) => { if (new Set(types).size !== types.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Target types must be distinct.' }); }).optional(),
} as const;
function validateTagFilters(filters: { tagNames?: string[]; tagKeys?: string[]; tagMatch?: 'any' | 'all' }, context: z.RefinementCtx) {
  if (filters.tagNames && filters.tagKeys) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tagNames'], message: 'Choose tagNames or tagKeys, not both.' });
  if (filters.tagMatch && !filters.tagNames && !filters.tagKeys) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tagMatch'], message: 'tagMatch requires tagNames or tagKeys.' });
}
export const appSearchFiltersSchema = z.object(appSearchFiltersShape).strict().superRefine(validateTagFilters).transform((filters) => (filters.tagNames || filters.tagKeys) && !filters.tagMatch ? { ...filters, tagMatch: 'any' as const } : filters);
export const appSearchLimitSchema = z.number().int().min(1).max(50);
export const appSearchInputShape = {
  operation: appSearchOperationSchema.optional(),
  query: z.string().trim().min(1).max(500).optional(),
  collectionSlugs: z.array(appSearchCollectionSlugSchema).min(1).max(appSearchCollectionSlugSchema.options.length).superRefine((slugs, context) => {
    if (new Set(slugs).size !== slugs.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Collection slugs must be distinct.' });
  }),
  recordHistory: z.boolean().default(true),
  limit: appSearchLimitSchema.default(10),
  field: appSearchSumFieldSchema.optional(),
  key: z.string().cuid().optional(),
  summary: z.object({ topic: z.string().trim().min(1).max(500).optional(), style: z.enum(['brief', 'detailed', 'executive', 'bullet-points', 'technical']).default('brief'), language: z.string().trim().min(1).max(100).optional() }).strict().optional(),
  filters: appSearchFiltersSchema.optional(),
} as const;
export function validateAppSearchInput(input: z.infer<z.ZodObject<typeof appSearchInputShape>>, context: z.RefinementCtx) {
  const operation = input.operation ?? (input.query ? 'search' : 'list');
  if (operation === 'search' && !input.query) context.addIssue({ code: 'custom', path: ['query'], message: 'Search requires a query.' });
  if (operation !== 'search' && input.query !== undefined) context.addIssue({ code: 'custom', path: ['query'], message: `${operation} does not accept a search query.` });
  if ((operation === 'get' || operation === 'summarize') && !input.key) context.addIssue({ code: 'custom', path: ['key'], message: `${operation} requires a resource key.` });
  if ((operation === 'get' || operation === 'summarize') && input.collectionSlugs.length !== 1) context.addIssue({ code: 'custom', path: ['collectionSlugs'], message: `${operation} accepts exactly one collection.` });
  if (operation !== 'get' && operation !== 'summarize' && input.key !== undefined) context.addIssue({ code: 'custom', path: ['key'], message: `${operation} does not accept a resource key.` });
  if ((operation === 'get' || operation === 'summarize') && input.filters !== undefined) context.addIssue({ code: 'custom', path: ['filters'], message: `${operation} does not accept filters.` });
  if (operation !== 'summarize' && input.summary !== undefined) context.addIssue({ code: 'custom', path: ['summary'], message: 'Summary options require summarize.' });
  if (operation === 'sum' && !input.field) context.addIssue({ code: 'custom', path: ['field'], message: 'sum requires a field.' });
  if (operation !== 'sum' && input.field !== undefined) context.addIssue({ code: 'custom', path: ['field'], message: 'A sum field requires sum.' });
  for (const slug of input.collectionSlugs) if (!(APP_SEARCH_COLLECTION_OPERATIONS[slug] as readonly string[]).includes(operation)) context.addIssue({ code: 'custom', path: ['collectionSlugs'], message: `${operation} is not supported for ${slug}.` });
  if (operation === 'sum' && input.field) for (const slug of input.collectionSlugs) if (!(APP_SEARCH_COLLECTION_ADAPTERS[slug] as AppSearchCollectionAdapter).sumFields?.[input.field]) context.addIssue({ code: 'custom', path: ['field'], message: `${input.field} cannot be summed for ${slug}.` });
  const supportsFilter = (filter: AppSearchFilterName) => {
    if (input.collectionSlugs.some((slug) => !(APP_SEARCH_COLLECTION_ADAPTERS[slug].filters as readonly AppSearchFilterName[]).includes(filter))) context.addIssue({ code: 'custom', path: ['filters', filter], message: `${filter} does not apply to every requested collection.` });
  };
  if (input.filters) for (const filter of Object.keys(input.filters) as AppSearchFilterName[]) if (input.filters[filter] !== undefined) supportsFilter(filter);
  if (input.filters?.includeDescendants !== undefined) {
    if (!input.filters.folderKey) context.addIssue({ code: 'custom', path: ['filters', 'includeDescendants'], message: 'includeDescendants requires folderKey.' });
  }
  if (input.filters?.emailFacets && input.filters.emailFacets.length > 1 && !input.filters.readState) context.addIssue({ code: 'custom', path: ['filters', 'emailFacets'], message: 'Multiple email facets require readState.' });
  if ((operation === 'list' || operation === 'count') && input.collectionSlugs.some((slug) => slug === 'email-messages' || slug === 'email-drafts') && !input.filters?.connectorKey && !input.filters?.tagNames && !input.filters?.tagKeys) context.addIssue({ code: 'custom', path: ['filters', 'connectorKey'], message: 'Email list and count operations require connectorKey unless exact tag filtering is used.' });
  if ((input.filters?.status !== undefined || input.filters?.isFavorite !== undefined) && operation !== 'list' && operation !== 'count' && operation !== 'sum') context.addIssue({ code: 'custom', path: ['filters'], message: 'status and isFavorite filters require list, count, or sum.' });
  if (input.filters?.status && input.collectionSlugs.some((slug) => !(APP_SEARCH_COLLECTION_ADAPTERS[slug] as AppSearchCollectionAdapter).statuses?.includes(input.filters!.status!))) context.addIssue({ code: 'custom', path: ['filters', 'status'], message: 'status is not valid for every requested collection.' });
  if ((input.filters?.createdFrom || input.filters?.createdTo) && !['search', 'list', 'count', 'sum'].includes(operation)) context.addIssue({ code: 'custom', path: ['filters'], message: 'Date filters require search, list, count, or sum.' });
  if (input.filters?.createdFrom && input.filters.createdTo && input.filters.createdFrom > input.filters.createdTo) context.addIssue({ code: 'custom', path: ['filters', 'createdTo'], message: 'createdTo must not precede createdFrom.' });
  if ((input.filters?.tagNames || input.filters?.tagKeys) && input.collectionSlugs.some((slug) => slug === 'countries' || slug === 'tags')) context.addIssue({ code: 'custom', path: ['collectionSlugs'], message: 'countries and tags do not support resource tag filtering.' });
}
export const appSearchInputSchema = z.object(appSearchInputShape).strict().superRefine(validateAppSearchInput);
export const appSearchModelInputSchema = z.object({
  ...appSearchInputShape,
  filters: appSearchFiltersSchema.optional(),
  limit: appSearchLimitSchema.describe('Required user-visible result count. Use 1 for a singular answer target even when plural evidence identifies it, such as which collection contains these images; use an explicit requested quantity up to 50; use 10 for an unspecified plural; use 50 only for exhaustive inventories.'),
}).strict().superRefine(validateAppSearchInput);
export type AppSearchInput = z.infer<typeof appSearchInputSchema>;

const resultTagsSchema = z.array(z.object({ key: z.string().cuid(), name: z.string() }).strict());
const folderResultSchema = z.object({ key: z.string(), scopeKey: z.string(), name: z.string(), description: z.string().optional(), parentFolderKey: z.string().optional(), isFavorite: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), tags: resultTagsSchema.default([]) }).strict();
const documentResultSchema = z.object({ key: z.string(), scopeKey: z.string(), name: z.string(), folderKey: z.string().optional(), folder: z.object({ key: z.string(), name: z.string() }).strict().optional(), extension: z.string().optional(), mimeType: z.string().optional(), sizeBytes: z.number().int().positive().optional(), isFavorite: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), content: z.string().optional(), tags: resultTagsSchema.default([]) }).strict();
const imageResultSchema = z.object({
  key: z.string(), filename: z.string(), caption: z.string(), imageCaptionKey: z.string().nullable(), mimeType: z.string(), sizeBytes: z.number().int().nonnegative(), width: z.number().int(), height: z.number().int(),
  city: z.string().nullable(), country: z.string().nullable(), countryCode: z.string().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(), locationSource: z.enum(['exif', 'supplied', 'place']).nullable(),
  origin: z.enum(['uploaded', 'generated']), mutationPolicy: z.enum(['user', 'system-only']), isFavorite: z.boolean(), createdByKey: z.string().nullable().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), url: z.string().url(), score: z.number().optional(),
  collections: z.array(z.object({ key: z.string(), name: z.string() }).strict()).max(3).optional(), tags: resultTagsSchema.default([]),
}).strict();
const collectionResultSchema = z.object({
  key: z.string(), name: z.string(), description: z.string().nullable(), purpose: z.enum(['place-media', 'email-media', 'generated-media']).nullable(), mutationPolicy: z.enum(['user', 'system-only']), presentation: z.enum(['travel', 'communication', 'learning']).optional(),
  isFavorite: z.boolean(), count: z.number().int().nonnegative(), coverUrl: z.string().url().nullable(), memberKey: z.string(), isOwned: z.boolean(), role: z.enum(['owner', 'collaborator', 'viewer']), access: z.object({ canRead: z.boolean(), canContribute: z.boolean(), canManage: z.boolean() }).strict(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), tags: resultTagsSchema.default([]),
}).strict();
const inboxResultSchema = z.object({
  key: z.string(), connectorKey: z.string(), provider: z.literal('gmail'), email: z.string().email(), name: z.string(), description: z.string().optional(), coverUrl: z.string().url().optional(), isFavorite: z.boolean(),
  status: z.enum(['active', 'error', 'revoked']), syncEnabled: z.boolean(), syncStatus: z.enum(['idle', 'syncing', 'error']), lastSyncedAt: z.string().datetime().optional(), syncError: z.string().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), tags: resultTagsSchema.default([]),
}).strict();
const toneResultSchema = z.object({ key: z.string(), slug: z.enum(['casual', 'formal', 'concise', 'warm', 'direct']).optional(), name: z.string(), instruction: z.string(), isFavorite: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), tags: resultTagsSchema.default([]) }).strict();
const emailMessageResultSchema = z.object({
  key: z.string(), subject: z.string(), summary: z.string(), intent: z.string(), action: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']), state: z.enum(['needs_action', 'waiting', 'informational', 'filtered', 'done']), lastMessageAt: z.string().datetime(),
  snippet: z.string().optional(), content: z.string().optional(), contentTruncated: z.boolean().optional(), category: z.enum(['primary', 'updates', 'promotions', 'social', 'forums', 'other']).optional(), unread: z.boolean(), isRead: z.boolean(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(), latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean(), inboxCategory: z.enum(['Urgent', 'Important', 'Filtered']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number(), inbox: z.object({ key: z.string(), connectorKey: z.string(), name: z.string() }).strict().optional(), tags: resultTagsSchema.default([]),
}).strict();
const emailDraftBaseShape = {
  key: z.string(), tone: z.string().optional(), instruction: z.string().optional(), attachments: emailAttachmentRefsSchema.optional(), generatedContent: z.string(), finalContent: z.string().optional(), status: z.enum(['generated', 'edited', 'sending', 'sent', 'discarded']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional(), inbox: z.object({ key: z.string(), connectorKey: z.string(), name: z.string() }).strict().optional(), tags: resultTagsSchema.default([]),
};
const emailDraftResultSchema = z.discriminatedUnion('variant', [
  z.object({ ...emailDraftBaseShape, variant: z.literal('new'), connectorKey: z.string(), to: z.array(z.string().email()), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(), subject: z.string() }).strict(),
  z.object({ ...emailDraftBaseShape, variant: z.literal('reply'), threadKey: z.string(), messageKey: z.string(), replyMode: z.enum(['reply', 'reply_all']), to: z.array(z.string().email()), cc: z.array(z.string().email()), emailWritingProfileKey: z.string().optional() }).strict(),
]);
const placeResultSchema = travelPlaceSearchResultSchema.extend({ tags: resultTagsSchema.default([]) }).strict();
const tripResultSchema = travelTripSchema.extend({ tags: resultTagsSchema.default([]) }).strict();
const countryResultSchema = z.object({ name: z.string(), countryCode: z.string(), latitude: z.number(), longitude: z.number() }).strict();
const bookResultSchema = z.object({ key: z.string(), title: z.string(), subtitle: z.string(), description: z.string(), content: z.string().optional(), contentTruncated: z.boolean().optional(), status: z.enum(['queued', 'researching', 'planning', 'writing', 'narrating', 'finalizing', 'failed', 'ready', 'cancelled']), isFavorite: z.boolean(), isExtending: z.boolean(), coverUrl: z.string().url().optional(), narrator: z.object({ key: z.enum(['calm', 'clear', 'warm']), name: z.string(), description: z.string().optional(), previewUrl: z.string().url().optional() }).strict().optional(), estimatedMinutes: z.number().int().nonnegative(), chapterCount: z.number().int().nonnegative(), progressPercent: z.number().min(0).max(100), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), generationProgressPercent: z.number().min(0).max(100).optional(), failureMessage: z.string().optional(), currentChapterKey: z.string().optional(), score: z.number().optional(), tags: resultTagsSchema.default([]) }).strict();
const tagResultSchema = z.object({ key: z.string().cuid(), name: z.string().min(1).max(120), description: z.string().min(1).max(2000).optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number().optional() }).strict();
const tagAssignmentResultSchema = z.object({ key: z.string().cuid(), tag: z.object({ key: z.string().cuid(), name: z.string().min(1).max(120) }).strict(), target: z.object({ type: z.enum(['folder', 'document', 'image-collection', 'image', 'image-highlight', 'image-memory', 'place', 'trip', 'email-inbox', 'email-tone', 'email-thread', 'email-message', 'email-draft', 'book']), key: z.string().cuid(), label: z.string().min(1).max(4_000) }).strict() }).strict();

export const appSearchGroupSchema = z.discriminatedUnion('collectionSlug', [
  z.object({ collectionSlug: z.literal('folders'), results: z.array(folderResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('documents'), results: z.array(documentResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('files'), results: z.array(documentResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('collections'), results: z.array(collectionResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('images'), results: z.array(imageResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('inboxes'), results: z.array(inboxResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('email-tones'), results: z.array(toneResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('email-messages'), results: z.array(emailMessageResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('email-drafts'), results: z.array(emailDraftResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('places'), results: z.array(placeResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('trips'), results: z.array(tripResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('countries'), results: z.array(countryResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('books'), results: z.array(bookResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('tags'), results: z.array(tagResultSchema) }).strict(),
  z.object({ collectionSlug: z.literal('tag-assignments'), results: z.array(tagAssignmentResultSchema) }).strict(),
]);
export const appSearchOutputSchema = z.object({ query: z.string(), groups: z.array(appSearchGroupSchema) }).strict();
export type AppSearchOutput = z.infer<typeof appSearchOutputSchema>;
export const appSearchResourceOutputSchema = z.object({
  operation: z.enum(['list', 'get']),
  groups: z.array(z.object({ collectionSlug: appSearchCollectionSlugSchema, results: z.array(z.unknown()), totalCount: z.number().int().nonnegative().optional() }).strict()),
}).strict();
export const appSearchCountOutputSchema = z.object({ operation: z.literal('count'), groups: z.array(z.object({ collectionSlug: appSearchCollectionSlugSchema, count: z.number().int().nonnegative() }).strict()) }).strict();
export const appSearchSumOutputSchema = z.object({ operation: z.literal('sum'), groups: z.array(z.object({ collectionSlug: appSearchCollectionSlugSchema, field: appSearchSumFieldSchema, sum: z.number().int().nonnegative().safe(), unit: z.enum(['bytes', 'minutes', 'chapters']), matchedCount: z.number().int().nonnegative(), valueCount: z.number().int().nonnegative() }).strict()) }).strict();
export const appSearchSummaryOutputSchema = z.object({ operation: z.literal('summarize'), collectionSlug: z.enum(['documents', 'files']), key: z.string().cuid(), summary: z.string().min(1) }).strict();
export const appSearchResultSchema = z.union([appSearchOutputSchema, appSearchResourceOutputSchema, appSearchCountOutputSchema, appSearchSumOutputSchema, appSearchSummaryOutputSchema]);
export type AppSearchResourceOutput = z.infer<typeof appSearchResourceOutputSchema>;
export type AppSearchCountOutput = z.infer<typeof appSearchCountOutputSchema>;
export type AppSearchSumOutput = z.infer<typeof appSearchSumOutputSchema>;
export type AppSearchSummaryOutput = z.infer<typeof appSearchSummaryOutputSchema>;
export type AppSearchResult = z.infer<typeof appSearchResultSchema>;

const APP_SEARCH_MODEL_EVIDENCE_LIMIT = 24_000;
const APP_SEARCH_MODEL_ITEM_EVIDENCE_LIMIT = 6_000;

function stringField(item: Record<string, unknown>, ...fields: string[]) {
  return fields.map((field) => item[field]).find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function nestedEvidence(collectionSlug: unknown, item: Record<string, unknown>) {
  const direct = stringField(item, 'content', 'finalContent', 'generatedContent', 'instruction');
  if (direct) return direct;
  const rows = collectionSlug === 'email-messages' && Array.isArray(item.messages)
    ? item.messages.map((value) => {
        const message = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return [stringField(message, 'from'), stringField(message, 'sentAt'), stringField(message, 'subject'), stringField(message, 'body')].filter(Boolean).join('\n');
      })
    : collectionSlug === 'books' && Array.isArray(item.chapters)
      ? item.chapters.map((value) => {
          const chapter = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          return [stringField(chapter, 'title'), stringField(chapter, 'description'), stringField(chapter, 'content')].filter(Boolean).join('\n');
        })
      : collectionSlug === 'trips' && Array.isArray(item.places)
        ? item.places.map((value) => {
            const place = value && typeof value === 'object' ? value as Record<string, unknown> : {};
            return [stringField(place, 'name'), stringField(place, 'summary')].filter(Boolean).join(': ');
          })
        : [];
  return rows.filter(Boolean).join('\n\n') || undefined;
}

function compactAppSearchModelItem(collectionSlug: unknown, value: unknown, evidenceLimit: number) {
  if (!value || typeof value !== 'object') return undefined;
  const outer = value as Record<string, unknown>;
  if (collectionSlug === 'tags') {
    const name = stringField(outer, 'name');
    const description = stringField(outer, 'description');
    return name ? { label: name.slice(0, 120), ...(description ? { description: description.slice(0, 2_000) } : {}) } : undefined;
  }
  if (collectionSlug === 'tag-assignments') {
    const tag = outer.tag && typeof outer.tag === 'object' ? stringField(outer.tag as Record<string, unknown>, 'name') : undefined;
    const target = outer.target && typeof outer.target === 'object' ? outer.target as Record<string, unknown> : undefined;
    const targetType = target ? stringField(target, 'type') : undefined;
    const targetLabel = target ? stringField(target, 'label') : undefined;
    return tag && targetType && targetLabel ? { tag: tag.slice(0, 120), targetType, targetLabel: targetLabel.slice(0, 4_000) } : undefined;
  }
  const nestedThread = collectionSlug === 'email-messages' && outer.thread && typeof outer.thread === 'object' ? outer.thread as Record<string, unknown> : undefined;
  const item = nestedThread ? { ...nestedThread, messages: outer.messages, contentTruncated: outer.truncated } : outer;
  const label = stringField(item, 'name', 'title', 'subject', 'caption', 'filename', 'email');
  const detail = stringField(item, 'description', 'summary', 'subtitle', 'intent', 'city', 'country');
  const evidence = nestedEvidence(collectionSlug, item);
  const content = evidence && evidenceLimit > 0 ? evidence.slice(0, evidenceLimit) : undefined;
  const copy = (field: string, type: 'string' | 'number' | 'boolean') => typeof item[field] === type ? item[field] : undefined;
  const reference = (value: unknown) => value && typeof value === 'object'
    ? { name: copyReference(value, 'name') }
    : undefined;
  const references = (field: string) => Array.isArray(item[field]) ? item[field].map(reference).filter((entry) => entry?.name).slice(0, 3) : [];
  const folder = reference(item.folder);
  const inbox = reference(item.inbox);
  const collections = references('collections');
  const trips = references('trips');
  const tags = (Array.isArray(outer.tags) ? outer.tags : Array.isArray(item.tags) ? item.tags : []).flatMap((value) => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? [{ name: ((value as { name: string }).name).slice(0, 160) }] : []);
  return {
    ...(label ? { label: label.slice(0, 160) } : {}),
    ...(detail && detail !== label ? { detail: detail.slice(0, 240) } : {}),
    ...Object.fromEntries(['email', 'countryCode', 'status', 'createdAt', 'updatedAt', 'priority', 'state', 'lastMessageAt', 'role'].flatMap((field) => copy(field, 'string') !== undefined ? [[field, copy(field, 'string')]] : [])),
    ...Object.fromEntries(['isFavorite', 'unread', 'isRead'].flatMap((field) => copy(field, 'boolean') !== undefined ? [[field, copy(field, 'boolean')]] : [])),
    ...Object.fromEntries(['count', 'sizeBytes', 'estimatedMinutes', 'chapterCount', 'progressPercent'].flatMap((field) => copy(field, 'number') !== undefined ? [[field, copy(field, 'number')]] : [])),
    ...(folder?.name ? { folder } : {}),
    ...(inbox?.name ? { inbox } : {}),
    ...(collections.length ? { collections } : {}),
    ...(trips.length ? { trips } : {}),
    ...(tags.length ? { tags } : {}),
    ...(content ? { content, contentTruncated: content.length < evidence!.length || item.contentTruncated === true } : {}),
  };
}

function copyReference(value: object, field: 'key' | 'name') {
  const selected = (value as Record<string, unknown>)[field];
  return typeof selected === 'string' && selected.trim() ? selected.trim().slice(0, field === 'name' ? 160 : 255) : undefined;
}

/** Produces the bounded, redacted workspace evidence supplied to any model after app.search. */
export function projectAppSearchModelResult(result: unknown) {
  if (!result || typeof result !== 'object') return result ?? null;
  const appResult = result as { operation?: unknown; query?: unknown; groups?: unknown; collectionSlug?: unknown; key?: unknown; summary?: unknown };
  if ((appResult.operation === 'count' || appResult.operation === 'sum') && Array.isArray(appResult.groups)) return { operation: appResult.operation, groups: appResult.groups };
  if (appResult.operation === 'summarize') return { operation: 'summarize', collectionSlug: appResult.collectionSlug, summary: appResult.summary };
  if (!Array.isArray(appResult.groups)) return result;
  const exampleLimit = appResult.operation === 'list' ? 50 : appResult.operation === 'get' ? 1 : 3;
  const visibleResultCount = appResult.groups.reduce((count, value) => {
    const results = value && typeof value === 'object' && Array.isArray((value as { results?: unknown }).results) ? (value as { results: unknown[] }).results : [];
    return count + Math.min(results.length, exampleLimit);
  }, 0);
  const evidenceLimit = Math.min(APP_SEARCH_MODEL_ITEM_EVIDENCE_LIMIT, Math.floor(APP_SEARCH_MODEL_EVIDENCE_LIMIT / Math.max(1, visibleResultCount)));
  return {
    ...(typeof appResult.operation === 'string' ? { operation: appResult.operation } : {}),
    ...(typeof appResult.query === 'string' ? { query: appResult.query } : {}),
    matchSemantics: appResult.operation === 'list' || appResult.operation === 'get' ? 'deterministic-resource-query' : 'ranked-best-match',
    groups: appResult.groups.map((value) => {
      const group = value && typeof value === 'object' ? value as { collectionSlug?: unknown; results?: unknown } : {};
      const results = Array.isArray(group.results) ? group.results : [];
      const examples = results.slice(0, exampleLimit).map((item) => compactAppSearchModelItem(group.collectionSlug, item, evidenceLimit)).filter((example) => example && Object.keys(example).length > 0);
      return { collectionSlug: group.collectionSlug, resultCount: results.length, examples };
    }),
  };
}

export const MAX_APP_SEARCH_RETRIEVAL_RESULTS = 100;
export const appSearchRetrievalResultSchema = z.object({
  key: z.string().trim().min(1).max(255),
  label: z.string().trim().min(1).max(200),
  destinationKey: z.string().trim().min(1).max(255).optional(),
  destinationCollectionSlug: appSearchCollectionSlugSchema.optional(),
}).strict();
export const appSearchRetrievalGroupSchema = z.object({
  collectionSlug: appSearchCollectionSlugSchema,
  results: z.array(appSearchRetrievalResultSchema).min(1).max(50),
}).strict();
export const appSearchRetrievalSchema = z.object({
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().min(1).max(50),
  minimumScore: z.number().min(-1).max(1).optional(),
  filters: appSearchFiltersSchema.optional(),
  searchCollectionSlugs: z.array(appSearchCollectionSlugSchema).min(1).max(10).optional(),
  groups: z.array(appSearchRetrievalGroupSchema).min(1).max(appSearchCollectionSlugSchema.options.length),
  source: z.enum(['search', 'results']).optional(),
}).strict().superRefine(({ query, source, groups }, context) => {
  if (source !== 'results' && (!query || query.length < 1)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['query'], message: 'Search retrievals require a query.' });
  if (groups.reduce((count, group) => count + group.results.length, 0) > MAX_APP_SEARCH_RETRIEVAL_RESULTS) context.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: `Retrievals may contain at most ${MAX_APP_SEARCH_RETRIEVAL_RESULTS} results.` });
});
export type AppSearchRetrievalResult = z.infer<typeof appSearchRetrievalResultSchema>;
export type AppSearchRetrievalGroup = z.infer<typeof appSearchRetrievalGroupSchema>;
export type AppSearchRetrieval = z.infer<typeof appSearchRetrievalSchema>;

function retrievalLabel(value: string, fallback: string) {
  return value.trim().slice(0, 200) || fallback;
}

type ImageSearchResultShape = { key: string; caption: string; filename: string; collections?: Array<{ key: string; name: string }> };

/** Matched images become one pill per accessible collection; collection-less images stay image pills. */
function imageCollectionPills(results: ImageSearchResultShape[]): AppSearchRetrievalResult[] {
  const seen = new Set<string>();
  const pills: AppSearchRetrievalResult[] = [];
  for (const result of results) {
    for (const collection of result.collections ?? []) {
      if (seen.has(collection.key)) continue;
      seen.add(collection.key);
      pills.push({ key: collection.key, label: retrievalLabel(collection.name, 'Collection') });
    }
  }
  return pills;
}

function uncollectedImageResults(results: ImageSearchResultShape[]): AppSearchRetrievalResult[] {
  return results.filter((result) => !result.collections?.length).map((result) => ({ key: result.key, label: retrievalLabel(result.caption.trim() || result.filename, 'Image') }));
}

export function projectAppSearchRetrieval(rawInput: unknown, rawOutput: unknown): AppSearchRetrieval | null {
  const input = z.object(appSearchInputShape).strict().parse(rawInput);
  if ((input.operation ?? 'search') !== 'search') return null;
  const output = appSearchOutputSchema.parse(rawOutput);
  let remaining = Math.min(MAX_APP_SEARCH_RETRIEVAL_RESULTS, input.limit * input.collectionSlugs.length);
  const projected = new Map<AppSearchCollectionSlug, AppSearchRetrievalResult[]>();
  const seen = new Map<string, AppSearchRetrievalResult>();
  const add = (collectionSlug: AppSearchCollectionSlug, result: AppSearchRetrievalResult) => {
    const identity = `${collectionSlug}:${result.key}`;
    const existing = seen.get(identity);
    if (existing) {
      if (!existing.destinationCollectionSlug && result.destinationCollectionSlug) existing.destinationCollectionSlug = result.destinationCollectionSlug;
      return;
    }
    if (remaining === 0) return;
    if ((projected.get(collectionSlug)?.length ?? 0) >= input.limit) return;
    seen.set(identity, result);
    projected.set(collectionSlug, [...(projected.get(collectionSlug) ?? []), result]);
    remaining -= 1;
  };
  for (const group of output.groups) {
    let results: AppSearchRetrievalResult[];
    switch (group.collectionSlug) {
      case 'countries': results = group.results.map((result) => ({ key: result.countryCode, label: retrievalLabel(result.name, 'Country') })); break;
      case 'images': {
        for (const result of imageCollectionPills(group.results)) add('collections', result);
        for (const result of uncollectedImageResults(group.results)) add('images', result);
        continue;
      }
      case 'documents':
      case 'files':
        for (const result of group.results) {
          if (result.folder) add('folders', { key: result.folder.key, label: retrievalLabel(result.folder.name, 'Folder'), destinationCollectionSlug: group.collectionSlug });
          else add(group.collectionSlug, { key: result.key, label: retrievalLabel(result.name, 'Resource') });
        }
        continue;
      case 'places':
        for (const result of group.results) {
          if (result.trips?.length) for (const trip of result.trips) add('trips', { key: trip.key, label: retrievalLabel(trip.name, 'Trip') });
          else add('places', { key: result.key, label: retrievalLabel(result.name, 'Place') });
        }
        continue;
      case 'inboxes': results = group.results.map((result) => ({ key: result.key, destinationKey: result.connectorKey, label: retrievalLabel(result.name || result.email, 'Inbox') })); break;
      case 'email-messages':
        for (const result of group.results) {
          if (result.inbox) add('inboxes', { key: result.inbox.key, destinationKey: result.inbox.connectorKey, destinationCollectionSlug: 'email-messages', label: retrievalLabel(result.inbox.name, 'Inbox') });
          else add('email-messages', { key: result.key, ...(input.filters?.connectorKey ? { destinationKey: input.filters.connectorKey } : {}), label: retrievalLabel(result.subject, 'Email message') });
        }
        continue;
      case 'email-drafts':
        for (const result of group.results) {
          if (result.inbox) add('inboxes', { key: result.inbox.key, destinationKey: result.inbox.connectorKey, destinationCollectionSlug: 'email-drafts', label: retrievalLabel(result.inbox.name, 'Inbox') });
          else add('email-drafts', { key: result.key, ...(input.filters?.connectorKey ? { destinationKey: input.filters.connectorKey } : {}), label: result.variant === 'new' ? retrievalLabel(result.subject, 'Email draft') : 'Reply draft' });
        }
        continue;
      case 'books': results = group.results.map((result) => ({ key: result.key, label: retrievalLabel(result.title, 'Audio book') })); break;
      case 'tag-assignments': results = group.results.map((result) => ({ key: result.key, label: retrievalLabel(result.target.label, 'Tagged resource') })); break;
      default: results = group.results.map((result) => ({ key: result.key, label: retrievalLabel(result.name, group.collectionSlug === 'trips' ? 'Trip' : 'Resource') }));
    }
    for (const result of results) add(group.collectionSlug, result);
  }
  const groups = [...projected].map(([collectionSlug, results]) => ({ collectionSlug, results }));
  if (!groups.length) return null;
  return appSearchRetrievalSchema.parse({ query: input.query, limit: input.limit, ...(input.filters ? { filters: input.filters } : {}), searchCollectionSlugs: input.collectionSlugs, groups });
}

const embeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const EMBEDDING_CACHE_TTL_MS = 5 * 60_000;
const EMBEDDING_CACHE_LIMIT = 500;

type ContentSearchOutput = { folders: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> };
export interface AppSearchDependencies extends Pick<ExecuteActionOptions, 'signal' | 'timeoutMs'> {
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  gallerySearch?: typeof galleryOperations.search;
  galleryCollectionSearch?: typeof searchGalleryCollections;
  galleryOverview?: typeof galleryOperations.overview;
  email?: EmailService;
  travel?: TravelService;
  countries?: CountrySearchService;
  books?: BookService;
  userSearches?: UserSearchService;
  scopeTags?: ScopeTagRepository;
  executeEmbedding?: (organizationKey: string, input: EmbeddingInput, options: Pick<ExecuteActionOptions, 'signal' | 'timeoutMs'>) => Promise<EmbeddingOutput>;
}

const APP_SEARCH_TAG_TARGET = {
  folders: 'folder', documents: 'document', files: 'document', collections: 'image-collection', images: 'image', inboxes: 'email-inbox', 'email-tones': 'email-tone',
  'email-messages': 'email-thread', 'email-drafts': 'email-draft', places: 'place', trips: 'trip', books: 'book',
} as const satisfies Record<Exclude<AppSearchCollectionSlug, 'countries' | 'tags' | 'tag-assignments'>, ScopeTagTarget['type']>;
const emptyScopeTags = {
  list: async () => [],
  get: async () => null,
  resolveOwnedByNormalizedNames: async () => [],
  searchOwned: async () => [],
  resolveCandidateKeys: async () => ({}),
  resolveEmailThreadKeys: async () => [],
  rankCandidateKeys: async () => [],
  listTargetTags: async () => ({}),
  listAssignments: async () => [],
  countAssignments: async () => 0,
  getAssignment: async () => null,
} as Pick<ScopeTagRepository, 'list' | 'get' | 'resolveOwnedByNormalizedNames' | 'searchOwned' | 'resolveCandidateKeys' | 'resolveEmailThreadKeys' | 'rankCandidateKeys' | 'listTargetTags' | 'listAssignments' | 'countAssignments' | 'getAssignment'>;
function actor(context: ToolContext) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userOrganization.status !== 'active' || principal.userOrganization.organizationId !== context.organizationKey || principal.userOrganization.userId !== principal.user.key) {
    throw new Error('Active matching organization membership is required.');
  }
  return {
    userKey: principal.user.key,
    membership: principal.userOrganization,
    serviceContext: { organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey },
  };
}

function batchData(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { results?: unknown }).results)) return [];
  return (value as { results: Array<{ success?: boolean; data?: unknown }> }).results.flatMap((result) => result.success && result.data !== undefined ? [result.data] : []);
}

function projectFolder(item: Record<string, any>) {
  return { key: item.key, scopeKey: item.scopeKey, name: item.name, ...(item.description ? { description: item.description } : {}), ...(item.parentFolderKey ? { parentFolderKey: item.parentFolderKey } : {}), isFavorite: item.isFavorite, ...(item.createdAt ? { createdAt: item.createdAt } : {}), ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}) };
}

function projectDocument(item: Record<string, any>) {
  const document = item.document ?? item;
  return { key: document.key ?? item.documentKey, scopeKey: document.scopeKey, name: document.name ?? item.title, ...(document.folderKey ? { folderKey: document.folderKey } : {}), ...(document.folder ? { folder: document.folder } : {}), ...(document.extension ? { extension: document.extension } : {}), ...(document.mimeType ? { mimeType: document.mimeType } : {}), ...(document.sizeBytes !== undefined ? { sizeBytes: document.sizeBytes } : {}), isFavorite: document.isFavorite ?? false, ...(document.createdAt ? { createdAt: document.createdAt } : {}), ...(document.updatedAt ? { updatedAt: document.updatedAt } : {}), ...(document.content !== undefined || item.content !== undefined ? { content: document.content ?? item.content } : {}) };
}

function projectTag(item: { key: string; name: string; description?: string; createdAt: string; updatedAt: string; score?: number }) {
  return tagResultSchema.parse({ key: item.key, name: item.name, ...(item.description ? { description: item.description } : {}), createdAt: item.createdAt, updatedAt: item.updatedAt, ...(item.score !== undefined ? { score: item.score } : {}) });
}

function filterStructuredResources(items: unknown[], input: AppSearchInput) {
  return items.filter((value) => {
    if (!value || typeof value !== 'object') return false;
    const item = value as { status?: unknown; isFavorite?: unknown; createdAt?: unknown };
    if (input.filters?.status !== undefined && item.status !== input.filters.status) return false;
    if (input.filters?.isFavorite !== undefined && item.isFavorite !== input.filters.isFavorite) return false;
    if (input.filters?.createdFrom !== undefined && (typeof item.createdAt !== 'string' || item.createdAt < input.filters.createdFrom)) return false;
    if (input.filters?.createdTo !== undefined && (typeof item.createdAt !== 'string' || item.createdAt > input.filters.createdTo)) return false;
    return true;
  });
}

function creationDateRange(input: AppSearchInput) {
  return {
    ...(input.filters?.createdFrom ? { createdFrom: input.filters.createdFrom } : {}),
    ...(input.filters?.createdTo ? { createdTo: input.filters.createdTo } : {}),
  };
}

function relevantExcerpt(value: string, query: string, limit = APP_SEARCH_MODEL_ITEM_EVIDENCE_LIMIT) {
  if (value.length <= limit) return value;
  const lower = value.toLocaleLowerCase();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length >= 3);
  const match = lower.indexOf(normalizedQuery);
  const index = match >= 0 ? match : terms.map((term) => lower.indexOf(term)).find((position) => position >= 0) ?? 0;
  const start = Math.max(0, Math.min(value.length - limit, index - Math.floor(limit / 3)));
  return `${start > 0 ? '...' : ''}${value.slice(start, start + limit - (start > 0 ? 3 : 0) - (start + limit < value.length ? 3 : 0))}${start + limit < value.length ? '...' : ''}`;
}

function emailThreadEvidence(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { messages?: unknown }).messages)) return '';
  return (value as { messages: unknown[] }).messages.map((entry) => {
    const message = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    return [stringField(message, 'from'), stringField(message, 'sentAt'), stringField(message, 'subject'), stringField(message, 'body')].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}

function bookChapterEvidence(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { chapters?: unknown }).chapters)) return '';
  return (value as { chapters: unknown[] }).chapters.map((entry) => {
    const chapter = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    return [stringField(chapter, 'title'), stringField(chapter, 'description'), stringField(chapter, 'content')].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}

function rethrowAbort(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

function emailOverviewInput(input: AppSearchInput, cursor?: string) {
  const connectorKey = input.filters?.connectorKey;
  if (!connectorKey) throw new Error('email-messages and email-drafts list/count operations require filters.connectorKey from an authorized inbox result.');
  const facets = input.filters?.emailFacets;
  if (input.filters?.readState) return { connectorKey, readState: input.filters.readState, facets: facets ?? [], cursor, limit: input.limit, ...creationDateRange(input) };
  const filter = input.filters?.readState === 'unread' ? 'unread' : facets?.length === 1 ? facets[0] : 'all';
  return { connectorKey, filter, cursor, limit: input.limit, ...creationDateRange(input) };
}

export function createAppSearchService(defaults: AppSearchDependencies = {}) {
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation: 'list' | 'get' }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchResourceOutput>;
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation: 'count' }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchCountOutput>;
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation: 'sum' }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchSumOutput>;
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation: 'summarize' }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchSummaryOutput>;
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation?: undefined; query?: undefined }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchResourceOutput>;
  function search(rawInput: z.input<typeof appSearchInputSchema> & { operation?: 'search' }, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchOutput>;
  function search(rawInput: unknown, context: ToolContext, execution?: AppSearchDependencies): Promise<AppSearchResult>;
  async function search(rawInput: unknown, context: ToolContext, execution: AppSearchDependencies = {}): Promise<AppSearchResult> {
    try {
      const input = appSearchInputSchema.parse(rawInput);
      const trusted = actor(context);
      const dependencies = { ...defaults, ...execution };
      const operation = input.operation ?? (input.query ? 'search' : 'list');
      const email = dependencies.email ?? createEmailService();
      const emailActor = { ...trusted.serviceContext, userKey: trusted.userKey };
      const travel = dependencies.travel ?? createTravelService();
      const books = dependencies.books ?? defaultBookService;
      const galleryContext = { ...trusted.serviceContext, membership: trusted.membership, signal: dependencies.signal } as GalleryOperationContext;
      const executeContent = dependencies.executeContent ?? runContentTool;
       // Tests and specialized injected adapters must supply scopeTags to opt into database-backed
       // projection; the production singleton has no defaults and always uses the canonical repository.
       const projectTags = Boolean(dependencies.scopeTags) || !Object.keys(defaults).length;
       const scopeTags = dependencies.scopeTags ?? (projectTags ? getDefaultScopeTagRepository() : emptyScopeTags);
       const scopeTagQueries = createScopeTagService({ repository: scopeTags as ScopeTagRepository });
      const tagOwner = { organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, userKey: trusted.userKey, membershipKey: trusted.membership.key };
       const targetTypes = [...new Set(input.collectionSlugs.flatMap((slug) => slug === 'countries' || slug === 'tags' || slug === 'tag-assignments' ? [] : slug === 'email-messages' ? ['email-thread' as const, 'email-message' as const] : [APP_SEARCH_TAG_TARGET[slug]]))];
       let candidateKeys: Record<string, string[]> | undefined;
       if (targetTypes.length && (input.filters?.tagNames || input.filters?.tagKeys)) {
         const owned = input.filters.tagNames
           ? await scopeTags.resolveOwnedByNormalizedNames(tagOwner, input.filters.tagNames.map(normalizeScopeTagName))
           : await Promise.all(input.filters.tagKeys!.map((tagKey) => scopeTags.get(tagOwner, tagKey)));
         if (owned.some((tag) => !tag)) throw new ContentError('CONTENT_NOT_FOUND', 'Tag was not found in the authenticated user and scope.', 'app.search', { action: 'resolution' });
         if (input.filters.tagNames && owned.length !== input.filters.tagNames.length) throw new ContentError('CONTENT_NOT_FOUND', 'Tag was not found in the authenticated user and scope.', 'app.search', { action: 'resolution' });
          candidateKeys = await scopeTags.resolveCandidateKeys(tagOwner, owned.map((tag) => tag!.key), targetTypes, input.filters.tagMatch ?? 'any');
         if (input.collectionSlugs.includes('email-messages')) candidateKeys['email-thread'] = [...new Set([...(candidateKeys['email-thread'] ?? []), ...await scopeTags.resolveEmailThreadKeys(tagOwner, candidateKeys['email-message'] ?? [])])];
      }
      const isCandidate = (slug: Exclude<AppSearchCollectionSlug, 'countries' | 'tags' | 'tag-assignments'>, value: unknown) => {
        if (!candidateKeys) return true;
        const item = value && typeof value === 'object' ? value as Record<string, any> : {};
        const key = typeof item.key === 'string' ? item.key : typeof item.documentKey === 'string' ? item.documentKey : typeof item.thread?.key === 'string' ? item.thread.key : undefined;
        return Boolean(key && candidateKeys[APP_SEARCH_TAG_TARGET[slug]]?.includes(key));
      };
      const tagResults = async <T extends AppSearchResult>(result: T): Promise<T> => {
         if (!projectTags || !('groups' in result) || (result as any).operation === 'count' || (result as any).operation === 'sum') return result;
         const targets = result.groups.flatMap((group: any) => group.collectionSlug === 'countries' || group.collectionSlug === 'tags' || group.collectionSlug === 'tag-assignments' ? [] : group.results.flatMap((item: any) => {
          const key = item?.key ?? item?.documentKey ?? item?.thread?.key;
           return typeof key === 'string' ? [{ type: APP_SEARCH_TAG_TARGET[group.collectionSlug as Exclude<AppSearchCollectionSlug, 'countries' | 'tags' | 'tag-assignments'>], key }] : [];
         }));
        if (!targets.length) return result;
        const tags = await scopeTags.listTargetTags(tagOwner, targets);
        return { ...result, groups: result.groups.map((group: any) => group.collectionSlug === 'countries' || group.collectionSlug === 'tags' || group.collectionSlug === 'tag-assignments' ? group : ({ ...group, results: group.results.map((item: any) => {
          const key = item?.key ?? item?.documentKey ?? item?.thread?.key;
           return { ...item, tags: tags[`${APP_SEARCH_TAG_TARGET[group.collectionSlug as Exclude<AppSearchCollectionSlug, 'countries' | 'tags' | 'tag-assignments'>]}\0${key}`] ?? [] };
        }) })) } as T;
      };

      const archiveList = async (slug: 'folders' | 'documents' | 'files', all = false) => {
        const results: Record<string, unknown>[] = [];
        let cursor: string | undefined;
        do {
          if (slug === 'folders') {
            const output = await executeContent('folder.list', { scopeKey: context.runtimeScopeKey, ...(input.filters?.folderKey ? { parentFolderKey: input.filters.folderKey } : {}), ...(input.filters?.includeDescendants !== undefined ? { includeDescendants: input.filters.includeDescendants } : {}), ...creationDateRange(input), cursor, limit: all ? 100 : input.limit }, context, dependencies.contentDependencies) as { folders: Record<string, unknown>[]; cursor?: string };
            results.push(...output.folders.map(projectFolder)); cursor = output.cursor;
          } else {
            const output = await executeContent('document.list', { scopeKey: context.runtimeScopeKey, ...(input.filters?.folderKey ? { folderKey: input.filters.folderKey, ...(input.filters.includeDescendants !== undefined ? { includeDescendants: input.filters.includeDescendants } : {}) } : {}), ...creationDateRange(input), cursor, limit: 100 }, context, dependencies.contentDependencies) as { documents: Record<string, unknown>[]; cursor?: string };
            results.push(...output.documents.filter((item) => slug === 'files' ? Boolean(item.extension) : !item.extension).map(projectDocument)); cursor = output.cursor;
          }
        } while (cursor && (all || results.length < input.limit));
        const selected = results.filter((item) => isCandidate(slug, item));
        return all ? selected : selected.slice(0, input.limit);
      };

      const list = async (slug: AppSearchCollectionSlug, all = false): Promise<unknown[]> => {
        if (slug === 'tags') {
          const result = await scopeTagQueries.queryTags({ operation: all ? 'count' : 'list', ...creationDateRange(input), ...(all ? {} : { limit: input.limit }) }, context);
          if (all) return Array.from({ length: result.count ?? 0 });
          return (result.items ?? []).map((tag) => projectTag(tag as Parameters<typeof projectTag>[0]));
        }
        if (slug === 'tag-assignments') {
          const result = await scopeTagQueries.queryAssignments({ operation: 'list', tagNames: input.filters?.tagNames, tagKeys: input.filters?.tagKeys, tagMatch: input.filters?.tagMatch ?? 'any', targetTypes: input.filters?.targetTypes, limit: input.limit }, context);
          return result.items ?? [];
        }
        if (slug === 'folders' || slug === 'documents' || slug === 'files') return archiveList(slug, all);
        if (slug === 'collections' || slug === 'images') {
          const galleryOverview = dependencies.galleryOverview ?? galleryOperations.overview;
          const overviewInput = { ...(input.filters?.collectionKey ? { collectionKey: input.filters.collectionKey } : {}), ...creationDateRange(input) };
          const output = await galleryOverview({ ...overviewInput, limit: all ? 100 : input.limit }, galleryContext) as { collections: unknown[]; images: unknown[]; nextCursor?: string };
          if (slug === 'collections' || !all) return filterStructuredResources(slug === 'collections' ? output.collections : output.images, input).filter((item) => isCandidate(slug, item)).slice(0, all ? undefined : input.limit);
          const images = [...output.images]; let cursor = output.nextCursor;
          while (cursor) {
            const page = await galleryOverview({ ...overviewInput, cursor, limit: 100 }, galleryContext) as { images: unknown[]; nextCursor?: string };
            images.push(...page.images); cursor = page.nextCursor;
          }
          return filterStructuredResources(images, input).filter((item) => isCandidate('images', item));
        }
        if (slug === 'inboxes' || slug === 'email-tones') {
          const output = await email.overview(emailActor, {});
          return filterStructuredResources(slug === 'inboxes' ? output.accounts : output.tones, input).filter((item) => isCandidate(slug, item)).slice(0, all ? undefined : input.limit);
        }
        if (slug === 'email-messages') {
          const connectorKeys = input.filters?.connectorKey ? [input.filters.connectorKey] : (await email.overview(emailActor, {})).accounts.map(({ connectorKey }) => connectorKey);
          const threads: unknown[] = [];
          for (const connectorKey of connectorKeys) {
            const scopedInput = { ...input, filters: { ...input.filters, connectorKey } };
            const output = await email.overview(emailActor, emailOverviewInput(scopedInput));
            threads.push(...output.threads); let cursor = output.nextCursor ?? undefined;
            while (all && cursor) { const page = await email.overview(emailActor, emailOverviewInput(scopedInput, cursor)); threads.push(...page.threads); cursor = page.nextCursor ?? undefined; }
          }
          return threads.filter((item) => isCandidate('email-messages', item)).slice(0, all ? undefined : input.limit);
        }
        if (slug === 'email-drafts') {
          const connectorKeys = input.filters?.connectorKey ? [input.filters.connectorKey] : (await email.overview(emailActor, {})).accounts.map(({ connectorKey }) => connectorKey);
          const drafts = [];
          for (const connectorKey of connectorKeys) {
            const first = await email.listDrafts(emailActor, { connectorKey, ...creationDateRange(input), limit: all ? 100 : input.limit });
            drafts.push(...first.drafts);
            for (let offset = first.drafts.length; all && offset < first.total; offset += 100) drafts.push(...(await email.listDrafts(emailActor, { connectorKey, ...creationDateRange(input), offset, limit: 100 })).drafts);
          }
          return drafts.filter((item) => isCandidate('email-drafts', item)).slice(0, all ? undefined : input.limit);
        }
        if (slug === 'books') return filterStructuredResources((await books.overview(trusted.serviceContext, trusted.userKey)).books, input).filter((item) => isCandidate('books', item)).slice(0, all ? undefined : input.limit);
        if (slug === 'trips') return filterStructuredResources((await travel.listTrips(trusted.serviceContext, trusted.userKey)).trips, input).filter((item) => isCandidate('trips', item)).slice(0, all ? undefined : input.limit);
        if (slug === 'places') return filterStructuredResources((await travel.overview(trusted.serviceContext, trusted.userKey)).places, input).filter((item) => isCandidate('places', item)).slice(0, all ? undefined : input.limit);
        throw new Error(`${slug} does not support ${operation}.`);
      };

      if (operation === 'list') {
        return tagResults(appSearchResourceOutputSchema.parse({ operation, groups: await Promise.all(input.collectionSlugs.map(async (collectionSlug) => ({ collectionSlug, results: (await list(collectionSlug, Boolean(input.filters?.tagNames || input.filters?.tagKeys))).slice(0, input.limit) }))) }));
      }
      if (operation === 'count') {
        const groups = await Promise.all(input.collectionSlugs.map(async (collectionSlug) => {
          if (collectionSlug === 'tag-assignments') { const result = await scopeTagQueries.queryAssignments({ operation: 'count', tagNames: input.filters?.tagNames, tagKeys: input.filters?.tagKeys, tagMatch: input.filters?.tagMatch ?? 'any', targetTypes: input.filters?.targetTypes }, context); return { collectionSlug, count: result.count ?? 0 }; }
          if (collectionSlug === 'tags') { const result = await scopeTagQueries.queryTags({ operation: 'count', ...creationDateRange(input) }, context); return { collectionSlug, count: result.count ?? 0 }; }
          if (collectionSlug === 'email-messages') {
            const output = await email.overview(emailActor, emailOverviewInput(input));
            const facets = input.filters?.emailFacets;
            const hasDateRange = input.filters?.createdFrom !== undefined || input.filters?.createdTo !== undefined;
            if (!candidateKeys && !hasDateRange && (!input.filters?.readState || input.filters.readState === 'unread' && !facets?.length)) {
              const facet = input.filters?.readState === 'unread' ? 'unread' : facets?.length === 1 ? facets[0] : 'all';
              return { collectionSlug, count: output.counts[facet as keyof typeof output.counts] };
            }
            let count = output.threads.filter((item) => isCandidate('email-messages', item)).length; let cursor = output.nextCursor ?? undefined;
            while (cursor) { const page = await email.overview(emailActor, emailOverviewInput(input, cursor)); count += page.threads.filter((item) => isCandidate('email-messages', item)).length; cursor = page.nextCursor ?? undefined; }
            return { collectionSlug, count };
          }
          if (collectionSlug === 'email-drafts' && !candidateKeys) {
            const output = await email.listDrafts(emailActor, { connectorKey: input.filters!.connectorKey!, ...creationDateRange(input), limit: 1 });
            return { collectionSlug, count: output.total };
          }
          return { collectionSlug, count: (await list(collectionSlug, true)).length };
        }));
        return appSearchCountOutputSchema.parse({ operation, groups });
      }
      if (operation === 'sum') {
        const field = input.field!;
        const groups = await Promise.all(input.collectionSlugs.map(async (collectionSlug) => {
          const items = await list(collectionSlug, true);
          let sum = 0; let valueCount = 0;
          for (const item of items) {
            const value = item && typeof item === 'object' ? (item as Record<string, unknown>)[field] : undefined;
            if (value === undefined) continue;
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is not a nonnegative safe integer for ${collectionSlug}.`);
            sum += value; valueCount += 1;
            if (!Number.isSafeInteger(sum)) throw new Error(`${field} sum exceeds the exact numeric range.`);
          }
          const metadata = (APP_SEARCH_COLLECTION_ADAPTERS[collectionSlug] as AppSearchCollectionAdapter).sumFields?.[field]!;
          return { collectionSlug, field, sum, unit: metadata.unit, matchedCount: items.length, valueCount };
        }));
        return appSearchSumOutputSchema.parse({ operation, groups });
      }
      if (operation === 'get') {
        const collectionSlug = input.collectionSlugs[0]!; let results: unknown[];
        if (collectionSlug === 'tags') { const result = await scopeTagQueries.queryTags({ operation: 'get', key: input.key }, context); results = (result.items ?? []).map((tag) => projectTag(tag as Parameters<typeof projectTag>[0])); }
        else if (collectionSlug === 'tag-assignments') results = (await scopeTagQueries.queryAssignments({ operation: 'get', key: input.key }, context)).items ?? [];
        else if (collectionSlug === 'folders') results = batchData(await executeContent('folder.find', { folderKeys: [input.key], includeChildrenCount: true, includeDocumentCount: true }, context, dependencies.contentDependencies)).map((item: any) => projectFolder(item.folder));
        else if (collectionSlug === 'documents' || collectionSlug === 'files') results = batchData(await executeContent('document.find', { documentKeys: [input.key], include: ['content', 'folder'] }, context, dependencies.contentDependencies)).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').map(projectDocument).filter((item) => collectionSlug === 'files' ? Boolean(item.extension) : !item.extension);
        else if (collectionSlug === 'books') { const detail = await books.detail(input.key!, trusted.serviceContext, trusted.userKey); results = [{ ...detail.book, chapters: detail.chapters }]; }
        else if (collectionSlug === 'collections') results = (await (dependencies.galleryOverview ?? galleryOperations.overview)({ collectionKey: input.key, limit: 1 }, galleryContext) as { collections: Array<{ key?: unknown }> }).collections.filter(({ key }) => key === input.key);
        else if (collectionSlug === 'inboxes') results = (await email.overview(emailActor, {})).accounts.filter(({ key }) => key === input.key);
        else if (collectionSlug === 'email-messages') { const thread = await email.threadForTool(emailActor, input.key!); results = thread ? [thread] : []; }
        else if (collectionSlug === 'trips') results = (await travel.listTrips(trusted.serviceContext, trusted.userKey)).trips.filter(({ key }) => key === input.key);
        else if (collectionSlug === 'places') results = (await travel.overview(trusted.serviceContext, trusted.userKey)).places.filter(({ key }) => key === input.key);
        else throw new Error(`${collectionSlug} does not support get.`);
        if (!results.length) throw new Error(`${collectionSlug} resource was not found.`);
        return tagResults(appSearchResourceOutputSchema.parse({ operation, groups: [{ collectionSlug, results }] }));
      }
      if (operation === 'summarize') {
        const collectionSlug = input.collectionSlugs[0]! as 'documents' | 'files';
        const output = await executeContent('document.summarize', { documentKeys: [input.key], ...input.summary, persist: false }, context, dependencies.contentDependencies);
        const data = batchData(output)[0] as { text?: unknown } | undefined;
        return appSearchSummaryOutputSchema.parse({ operation, collectionSlug, key: input.key, summary: data?.text });
      }

      const query = input.query!;
      const embeddingInput = { text: prepareEmbeddingText(query, 'query') };
      const embeddingCacheKey = `${context.organizationKey}\0${embeddingInput.text}`;
      const cachedEmbedding = embeddingCache.get(embeddingCacheKey);
      let queryEmbedding = cachedEmbedding && cachedEmbedding.expiresAt > Date.now() ? cachedEmbedding.embedding : undefined;
      if (!queryEmbedding) {
        embeddingCache.delete(embeddingCacheKey);
        const embeddingOutput = dependencies.executeEmbedding
          ? await dependencies.executeEmbedding(context.organizationKey, embeddingInput, dependencies)
          : (await executeAction<EmbeddingInput, EmbeddingOutput>({ mode: 'auto', organizationKey: context.organizationKey, actionSlug: 'embed' }, embeddingInput, dependencies)).output;
        queryEmbedding = currentEmbeddingSchema.parse(embeddingOutput.embedding);
        if (embeddingCache.size >= EMBEDDING_CACHE_LIMIT) embeddingCache.delete(embeddingCache.keys().next().value!);
        embeddingCache.set(embeddingCacheKey, { embedding: queryEmbedding, expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS });
      }
      if (candidateKeys) {
        const groups = await Promise.all(input.collectionSlugs.map(async (collectionSlug) => {
          if (collectionSlug === 'countries' || collectionSlug === 'tags' || collectionSlug === 'tag-assignments') return { collectionSlug, results: [] };
          const targetType = APP_SEARCH_TAG_TARGET[collectionSlug];
          const ranked = await scopeTags.rankCandidateKeys(tagOwner, targetType, candidateKeys[targetType] ?? [], queryEmbedding!);
          const authorized = await list(collectionSlug, true);
          const byKey = new Map(authorized.flatMap((item) => {
            const value = item && typeof item === 'object' ? item as Record<string, any> : {};
            const itemKey = value.key ?? value.documentKey ?? value.thread?.key;
            return typeof itemKey === 'string' ? [[itemKey, item] as const] : [];
          }));
          const results: unknown[] = [];
          for (const { key, score } of ranked) {
            const item = byKey.get(key);
            if (!item || typeof item !== 'object') continue;
            if (collectionSlug === 'folders') results.push(folderResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'documents' || collectionSlug === 'files') results.push(documentResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'images') results.push(imageResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'collections') results.push(collectionResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'inboxes') { const { initialSyncCompleted: _initialSyncCompleted, ...inbox } = item as Record<string, any>; results.push(inboxResultSchema.parse({ ...inbox, score })); }
            else if (collectionSlug === 'email-tones') results.push(toneResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'email-messages') results.push(emailMessageResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'email-drafts') results.push(emailDraftResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'places') results.push(placeResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'trips') results.push(tripResultSchema.parse({ ...item, score }));
            else if (collectionSlug === 'books') results.push(bookResultSchema.parse({ ...item, score }));
            if (results.length >= input.limit) break;
          }
          return { collectionSlug, results };
        }));
        return tagResults(appSearchOutputSchema.parse({ query, groups }));
      }
      const requested = new Set(input.collectionSlugs);
      const requestedDocumentCollections = Number(requested.has('documents')) + Number(requested.has('files'));
      const contentLimit = candidateKeys ? 100 : Math.min(100, input.limit * Math.max(1, requestedDocumentCollections));

      const contentPromise = [...requested].some((slug) => slug === 'folders' || slug === 'documents' || slug === 'files')
        ? (dependencies.executeContent ?? runContentTool)('content.search', {
            scopeKey: context.runtimeScopeKey,
            query: input.query,
            includeSummaries: false,
            minimumScore: -1,
            limit: contentLimit,
            recordHistory: false,
            ...creationDateRange(input),
            ...(input.filters?.folderKey ? { folderKey: input.filters.folderKey, includeDescendants: input.filters.includeDescendants ?? true } : {}),
          }, context, { ...dependencies.contentDependencies, queryEmbedding, ...(candidateKeys ? { searchQueries: { get: async () => null, record: async () => undefined } } : {}) }) as Promise<ContentSearchOutput>
        : undefined;
      const emailInboxesPromise = requested.has('email-messages') || requested.has('email-drafts')
        ? email.overview(emailActor, {}).then(({ accounts }) => accounts.map((account) => ({ key: account.key, connectorKey: account.connectorKey, name: account.name || account.email })))
        : undefined;
      const countries = dependencies.countries ?? createCountrySearchService();
      const commonSearchInput = { query, minimumScore: -1, limit: candidateKeys ? 50 : input.limit, recordHistory: false, ...creationDateRange(input) };

      const groupPromises = input.collectionSlugs.map(async (collectionSlug) => {
        if (collectionSlug === 'tags') { const result = await scopeTagQueries.queryTags({ operation: 'search', embedding: queryEmbedding, limit: input.limit, ...creationDateRange(input) }, context); return { collectionSlug, results: (result.items ?? []).map((tag) => projectTag(tag as Parameters<typeof projectTag>[0])) }; }
        if (collectionSlug === 'folders') {
          const output = await contentPromise!;
          return { collectionSlug, results: output.folders.filter((item) => isCandidate('folders', item)).slice(0, input.limit).map((item) => ({ key: item.key, scopeKey: item.scopeKey, name: item.name, ...(item.description ? { description: item.description } : {}), ...(item.parentFolderKey ? { parentFolderKey: item.parentFolderKey } : {}), isFavorite: item.isFavorite, ...(item.createdAt ? { createdAt: item.createdAt } : {}), ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}), score: item.score })) };
        }
        if (collectionSlug === 'documents' || collectionSlug === 'files') {
          const output = await contentPromise!;
          const documents = output.documents.filter((item) => (collectionSlug === 'files' ? Boolean(item.extension) : !item.extension) && isCandidate(collectionSlug, item)).slice(0, input.limit);
          const contentByKey = new Map<string, string>();
          try { if (documents.length) {
            const details = batchData(await executeContent('document.find', { documentKeys: documents.slice(0, 3).map(({ documentKey }) => documentKey), include: ['content'] }, context, dependencies.contentDependencies));
            for (const detail of details) {
              const projected = projectDocument(detail as Record<string, unknown>);
              if (typeof projected.key === 'string' && typeof projected.content === 'string') contentByKey.set(projected.key, relevantExcerpt(projected.content, query));
            }
          } } catch (error) { rethrowAbort(error); }
           return { collectionSlug, results: documents.map((item) => ({ key: item.documentKey, scopeKey: item.scopeKey, name: item.name, ...(item.folderKey ? { folderKey: item.folderKey } : {}), ...(item.folder ? { folder: item.folder } : {}), ...(item.extension ? { extension: item.extension } : {}), ...(item.mimeType ? { mimeType: item.mimeType } : {}), ...(item.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}), isFavorite: item.isFavorite, ...(item.createdAt ? { createdAt: item.createdAt } : {}), ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}), score: item.score, ...(contentByKey.has(item.documentKey as string) ? { content: contentByKey.get(item.documentKey as string) } : {}) })) };
        }
        if (collectionSlug === 'images') {
          const galleryContext = { ...trusted.serviceContext, membership: trusted.membership, signal: dependencies.signal, queryEmbedding, recordUserSearch: async () => undefined } as GalleryOperationContext;
          const output = await (dependencies.gallerySearch ?? galleryOperations.search)({ query, ...(input.filters?.collectionKey ? { collectionKey: input.filters.collectionKey } : {}), ...(input.filters?.createdFrom || input.filters?.createdTo ? { createdFrom: input.filters.createdFrom, createdTo: input.filters.createdTo } : {}), limit: candidateKeys ? 50 : input.limit, recordHistory: false }, { ...galleryContext, queryEmbedding, recordUserSearch: async () => undefined }) as { images: unknown[] };
          return { collectionSlug, results: output.images.filter((item) => isCandidate('images', item)).slice(0, input.limit).map((item) => imageResultSchema.parse(item)) };
        }
        if (collectionSlug === 'collections') {
          const galleryContext = { ...trusted.serviceContext, membership: trusted.membership, signal: dependencies.signal, queryEmbedding } as GalleryOperationContext;
          const output = await (dependencies.galleryCollectionSearch ?? searchGalleryCollections)({ query, minimumScore: -1, limit: candidateKeys ? 50 : input.limit, ...creationDateRange(input) }, { ...galleryContext, queryEmbedding }) as { collections: unknown[] };
          return { collectionSlug, results: output.collections.filter((item) => isCandidate('collections', item)).slice(0, input.limit).map((item) => collectionResultSchema.parse(item)) };
        }
        if (collectionSlug === 'inboxes') {
          const output = await email.searchInboxes(emailActor, commonSearchInput, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.inboxes.filter((item) => isCandidate('inboxes', item)).slice(0, input.limit).map(({ initialSyncCompleted: _initialSyncCompleted, ...item }) => inboxResultSchema.parse(item)) };
        }
        if (collectionSlug === 'email-tones') {
          const output = await email.searchTones(emailActor, commonSearchInput, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.tones.filter((item) => isCandidate('email-tones', item)).slice(0, input.limit).map((item) => toneResultSchema.parse(item)) };
        }
        if (collectionSlug === 'email-messages') {
          const inboxes = (await emailInboxesPromise!).filter((inbox) => !input.filters?.connectorKey || inbox.connectorKey === input.filters.connectorKey);
          const results = (await Promise.all(inboxes.map(async (inbox) => {
            const output = await email.searchMessages(emailActor, { ...commonSearchInput, connectorKey: inbox.connectorKey, ...(input.filters?.readState ? { readState: input.filters.readState } : {}), ...(input.filters?.emailFacets ? { facets: input.filters.emailFacets } : {}) }, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
            return output.threads.map((item) => emailMessageResultSchema.parse({ ...item, inbox }));
          }))).flat().filter((item) => isCandidate('email-messages', item)).sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.key.localeCompare(right.key)).slice(0, input.limit);
          const enriched = await Promise.all(results.map(async (result, index) => {
            if (index >= 3) return result;
            try {
              const detail = await email.threadForTool(emailActor, result.key);
              const content = relevantExcerpt(emailThreadEvidence(detail), query);
              return content ? emailMessageResultSchema.parse({ ...result, content, contentTruncated: detail.truncated || content.length < emailThreadEvidence(detail).length }) : result;
            } catch (error) { rethrowAbort(error); return result; }
          }));
          return { collectionSlug, results: enriched };
        }
        if (collectionSlug === 'email-drafts') {
          const inboxes = (await emailInboxesPromise!).filter((inbox) => !input.filters?.connectorKey || inbox.connectorKey === input.filters.connectorKey);
          const results = (await Promise.all(inboxes.map(async (inbox) => {
            const output = await email.searchDrafts(emailActor, { ...commonSearchInput, connectorKey: inbox.connectorKey }, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
            return output.drafts.map((item) => emailDraftResultSchema.parse({ ...item, inbox }));
          }))).flat().filter((item) => isCandidate('email-drafts', item)).sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.key.localeCompare(right.key)).slice(0, input.limit);
          return { collectionSlug, results };
        }
        if (collectionSlug === 'places') {
          const output = await travel.searchPlaces({ ...trusted.serviceContext, query, recordHistory: false, ...creationDateRange(input) }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.places.filter((item) => isCandidate('places', item)).slice(0, input.limit).map((item) => placeResultSchema.parse(item)) };
        }
        if (collectionSlug === 'trips') {
          const output = await travel.searchTrips({ ...trusted.serviceContext, query, recordHistory: false, ...creationDateRange(input) }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.trips.filter((item) => isCandidate('trips', item)).slice(0, input.limit).map((item) => tripResultSchema.parse(item)) };
        }
        if (collectionSlug === 'books') {
          const output = await books.search({ ...trusted.serviceContext, query, minimumScore: -1, limit: candidateKeys ? 50 : input.limit, ...creationDateRange(input) }, trusted.userKey, { queryEmbedding });
          const results = output.books.filter((item) => isCandidate('books', item)).slice(0, input.limit).map((item) => bookResultSchema.parse(item));
          const enriched = await Promise.all(results.map(async (result, index) => {
            if (index >= 3) return result;
            try {
              const detail = await books.detail(result.key, trusted.serviceContext, trusted.userKey);
              const fullContent = bookChapterEvidence(detail);
              const content = relevantExcerpt(fullContent, query);
              return content ? bookResultSchema.parse({ ...result, content, contentTruncated: content.length < fullContent.length }) : result;
            } catch (error) { rethrowAbort(error); return result; }
          }));
          return { collectionSlug, results: enriched };
        }
        const output = await countries.search({ organizationKey: context.organizationKey, query }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding, recordHistory: false, minimumScore: -1 });
        return { collectionSlug, results: output.country ? [output.country] : [] };
      });

      const output = await tagResults(appSearchOutputSchema.parse({ query, groups: await Promise.all(groupPromises) }));
      if (input.recordHistory) await (dependencies.userSearches ?? getDefaultUserSearchService()).record(trusted.userKey, query);
      return output;
    } catch (error) {
      if (error instanceof ScopeTagError) throw new ContentError(error.code === 'NOT_FOUND' ? 'CONTENT_NOT_FOUND' : 'CONTENT_FORBIDDEN', error.message, 'app.search', { action: 'query' });
      throw error;
    }
  }
  return { search };
}

export type AppSearchService = ReturnType<typeof createAppSearchService>;
