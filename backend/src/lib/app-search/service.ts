import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import type { EmbeddingInput, EmbeddingOutput } from '@/lib/ai/providers';
import { currentEmbeddingSchema, prepareEmbeddingText } from '@/lib/embeddings';
import { runContentTool, type ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { galleryOperations, searchGalleryCollections, type GalleryOperationContext } from '@/lib/gallery/operations';
import { createEmailService, type EmailService } from '@/lib/email-inbox/service';
import { emailAttachmentRefsSchema } from '@/lib/email-inbox/archive-payloads';
import { createTravelService, travelTripPlaceDtoSchema, travelTripSchema, type TravelService } from '@/lib/travel/service';
import { createCountrySearchService, type CountrySearchService } from '@/lib/travel/country-search';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';
import { defaultBookService } from '@/lib/books/default-service';
import type { BookService } from '@/lib/books/service';

export const appSearchCollectionSlugSchema = z.enum([
  'folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places', 'trips', 'countries', 'books',
]);
export type AppSearchCollectionSlug = z.infer<typeof appSearchCollectionSlugSchema>;

export const appSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  collectionSlugs: z.array(appSearchCollectionSlugSchema).min(1).max(10).superRefine((slugs, context) => {
    if (new Set(slugs).size !== slugs.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Collection slugs must be distinct.' });
  }),
  recordHistory: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(10),
  minimumScore: z.number().min(-1).max(1).default(0.55),
  filters: z.object({
    folderKey: z.string().cuid().optional(),
    includeDescendants: z.boolean().optional(),
    collectionKey: z.string().cuid().optional(),
    connectorKey: z.string().cuid().optional(),
    readState: z.enum(['read', 'unread']).optional(),
    emailFacets: z.array(z.enum(['urgent', 'important', 'filtered', 'favorite'])).max(4).optional(),
  }).strict().optional(),
}).strict();
export type AppSearchInput = z.infer<typeof appSearchInputSchema>;

const folderResultSchema = z.object({ key: z.string(), scopeKey: z.string(), name: z.string(), description: z.string().optional(), parentFolderKey: z.string().optional(), isFavorite: z.boolean(), score: z.number() }).strict();
const documentResultSchema = z.object({ key: z.string(), scopeKey: z.string(), name: z.string(), folderKey: z.string().optional(), extension: z.string().optional(), isFavorite: z.boolean(), score: z.number() }).strict();
const imageResultSchema = z.object({
  key: z.string(), filename: z.string(), caption: z.string(), imageCaptionKey: z.string().nullable(), mimeType: z.string(), sizeBytes: z.number().int().nonnegative(), width: z.number().int(), height: z.number().int(),
  city: z.string().nullable(), country: z.string().nullable(), countryCode: z.string().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable(), locationSource: z.enum(['exif', 'supplied', 'place']).nullable(),
  origin: z.enum(['uploaded', 'generated']), mutationPolicy: z.enum(['user', 'system-only']), isFavorite: z.boolean(), createdByKey: z.string().nullable().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), url: z.string().url(), score: z.number().optional(),
}).strict();
const collectionResultSchema = z.object({
  key: z.string(), name: z.string(), description: z.string().nullable(), purpose: z.enum(['place-media', 'email-media']).nullable(), mutationPolicy: z.enum(['user', 'system-only']), presentation: z.enum(['travel', 'communication', 'learning']).optional(),
  isFavorite: z.boolean(), count: z.number().int().nonnegative(), coverUrl: z.string().url().nullable(), memberKey: z.string(), isOwned: z.boolean(), role: z.enum(['owner', 'collaborator', 'viewer']), access: z.object({ canRead: z.boolean(), canContribute: z.boolean(), canManage: z.boolean() }).strict(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number(),
}).strict();
const inboxResultSchema = z.object({
  key: z.string(), connectorKey: z.string(), provider: z.literal('gmail'), email: z.string().email(), name: z.string(), description: z.string().optional(), coverUrl: z.string().url().optional(), isFavorite: z.boolean(),
  status: z.enum(['active', 'error', 'revoked']), syncEnabled: z.boolean(), syncStatus: z.enum(['idle', 'syncing', 'error']), lastSyncedAt: z.string().datetime().optional(), syncError: z.string().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number(),
}).strict();
const toneResultSchema = z.object({ key: z.string(), slug: z.enum(['casual', 'formal', 'concise', 'warm', 'direct']).optional(), name: z.string(), instruction: z.string(), isFavorite: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number() }).strict();
const emailMessageResultSchema = z.object({
  key: z.string(), subject: z.string(), summary: z.string(), intent: z.string(), action: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']), state: z.enum(['needs_action', 'waiting', 'informational', 'filtered', 'done']), lastMessageAt: z.string().datetime(),
  snippet: z.string().optional(), category: z.enum(['primary', 'updates', 'promotions', 'social', 'forums', 'other']).optional(), unread: z.boolean(), isRead: z.boolean(), starred: z.boolean().optional(), labels: z.array(z.string()).optional(), latestFrom: z.string().email().optional(), inInbox: z.boolean().optional(), isFavorite: z.boolean(), inboxCategory: z.enum(['Urgent', 'Important', 'Filtered']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number(),
}).strict();
const emailDraftBaseShape = {
  key: z.string(), tone: z.string().optional(), instruction: z.string().optional(), attachments: emailAttachmentRefsSchema.optional(), generatedContent: z.string(), finalContent: z.string().optional(), status: z.enum(['generated', 'edited', 'sending', 'sent', 'discarded']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), score: z.number(),
};
const emailDraftResultSchema = z.discriminatedUnion('variant', [
  z.object({ ...emailDraftBaseShape, variant: z.literal('new'), connectorKey: z.string(), to: z.array(z.string().email()), cc: z.array(z.string().email()).optional(), bcc: z.array(z.string().email()).optional(), subject: z.string() }).strict(),
  z.object({ ...emailDraftBaseShape, variant: z.literal('reply'), threadKey: z.string(), messageKey: z.string(), replyMode: z.enum(['reply', 'reply_all']), to: z.array(z.string().email()), cc: z.array(z.string().email()), emailWritingProfileKey: z.string().optional() }).strict(),
]);
const placeResultSchema = travelTripPlaceDtoSchema;
const tripResultSchema = travelTripSchema;
const countryResultSchema = z.object({ name: z.string(), countryCode: z.string(), latitude: z.number(), longitude: z.number() }).strict();
const bookResultSchema = z.object({ key: z.string(), title: z.string(), subtitle: z.string(), description: z.string(), status: z.enum(['queued', 'researching', 'planning', 'writing', 'narrating', 'finalizing', 'failed', 'ready', 'cancelled']), isFavorite: z.boolean(), isExtending: z.boolean(), coverUrl: z.string().url().optional(), narrator: z.object({ key: z.enum(['calm', 'clear', 'warm']), name: z.string(), description: z.string().optional(), previewUrl: z.string().url().optional() }).strict().optional(), estimatedMinutes: z.number().int().nonnegative(), chapterCount: z.number().int().nonnegative(), progressPercent: z.number().min(0).max(100), generationProgressPercent: z.number().min(0).max(100).optional(), failureMessage: z.string().optional(), currentChapterKey: z.string().optional(), score: z.number() }).strict();

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
]);
export const appSearchOutputSchema = z.object({ query: z.string(), groups: z.array(appSearchGroupSchema) }).strict();
export type AppSearchOutput = z.infer<typeof appSearchOutputSchema>;

const embeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const EMBEDDING_CACHE_TTL_MS = 5 * 60_000;
const EMBEDDING_CACHE_LIMIT = 500;

type ContentSearchOutput = { folders: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> };
export interface AppSearchDependencies extends Pick<ExecuteActionOptions, 'signal' | 'timeoutMs'> {
  contentDependencies?: ContentToolDependencies;
  executeContent?: typeof runContentTool;
  gallerySearch?: typeof galleryOperations.search;
  galleryCollectionSearch?: typeof searchGalleryCollections;
  email?: EmailService;
  travel?: TravelService;
  countries?: CountrySearchService;
  books?: BookService;
  userSearches?: UserSearchService;
  executeEmbedding?: (organizationKey: string, input: EmbeddingInput, options: Pick<ExecuteActionOptions, 'signal' | 'timeoutMs'>) => Promise<EmbeddingOutput>;
}

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

export function createAppSearchService(defaults: AppSearchDependencies = {}) {
  return {
    async search(rawInput: unknown, context: ToolContext, execution: AppSearchDependencies = {}): Promise<AppSearchOutput> {
      const input = appSearchInputSchema.parse(rawInput);
      const trusted = actor(context);
      const dependencies = { ...defaults, ...execution };
      const embeddingInput = { text: prepareEmbeddingText(input.query, 'query') };
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
      const requested = new Set(input.collectionSlugs);

      const contentPromise = [...requested].some((slug) => slug === 'folders' || slug === 'documents' || slug === 'files')
        ? (dependencies.executeContent ?? runContentTool)('content.search', {
            scopeKey: context.runtimeScopeKey,
            query: input.query,
            includeSummaries: false,
            minimumScore: input.minimumScore,
            recordHistory: false,
            ...(input.filters?.folderKey ? { folderKey: input.filters.folderKey, includeDescendants: input.filters.includeDescendants ?? true } : {}),
          }, context, { ...dependencies.contentDependencies, queryEmbedding }) as Promise<ContentSearchOutput>
        : undefined;
      const email = dependencies.email ?? createEmailService();
      const travel = dependencies.travel ?? createTravelService();
      const countries = dependencies.countries ?? createCountrySearchService();
      const commonSearchInput = { query: input.query, minimumScore: input.minimumScore, limit: input.limit, recordHistory: false };

      const groupPromises = input.collectionSlugs.map(async (collectionSlug) => {
        if (collectionSlug === 'folders') {
          const output = await contentPromise!;
          return { collectionSlug, results: output.folders.slice(0, input.limit).map((item) => ({ key: item.key, scopeKey: item.scopeKey, name: item.name, ...(item.description ? { description: item.description } : {}), ...(item.parentFolderKey ? { parentFolderKey: item.parentFolderKey } : {}), isFavorite: item.isFavorite, score: item.score })) };
        }
        if (collectionSlug === 'documents' || collectionSlug === 'files') {
          const output = await contentPromise!;
          const documents = output.documents.filter((item) => collectionSlug === 'files' ? Boolean(item.extension) : !item.extension).slice(0, input.limit);
          return { collectionSlug, results: documents.map((item) => ({ key: item.documentKey, scopeKey: item.scopeKey, name: item.name, ...(item.folderKey ? { folderKey: item.folderKey } : {}), ...(item.extension ? { extension: item.extension } : {}), isFavorite: item.isFavorite, score: item.score })) };
        }
        if (collectionSlug === 'images') {
          const galleryContext = { ...trusted.serviceContext, membership: trusted.membership, signal: dependencies.signal, queryEmbedding, recordUserSearch: async () => undefined } as GalleryOperationContext;
          const output = await (dependencies.gallerySearch ?? galleryOperations.search)({ query: input.query, ...(input.filters?.collectionKey ? { collectionKey: input.filters.collectionKey } : {}), threshold: input.minimumScore, limit: input.limit, recordHistory: false }, galleryContext) as { images: unknown[] };
          return { collectionSlug, results: output.images.map((item) => imageResultSchema.parse(item)) };
        }
        if (collectionSlug === 'collections') {
          const galleryContext = { ...trusted.serviceContext, membership: trusted.membership, signal: dependencies.signal, queryEmbedding } as GalleryOperationContext;
          const output = await (dependencies.galleryCollectionSearch ?? searchGalleryCollections)({ query: input.query, minimumScore: input.minimumScore, limit: input.limit }, galleryContext) as { collections: unknown[] };
          return { collectionSlug, results: output.collections.map((item) => collectionResultSchema.parse(item)) };
        }
        if (collectionSlug === 'inboxes') {
          const output = await email.searchInboxes({ ...trusted.serviceContext, userKey: trusted.userKey }, commonSearchInput, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.inboxes.map(({ initialSyncCompleted: _initialSyncCompleted, ...item }) => inboxResultSchema.parse(item)) };
        }
        if (collectionSlug === 'email-tones') {
          const output = await email.searchTones({ ...trusted.serviceContext, userKey: trusted.userKey }, commonSearchInput, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.tones.map((item) => toneResultSchema.parse(item)) };
        }
        if (collectionSlug === 'email-messages') {
          if (!input.filters?.connectorKey) throw new Error('connectorKey is required to search email messages.');
          const output = await email.searchMessages({ ...trusted.serviceContext, userKey: trusted.userKey }, { ...commonSearchInput, connectorKey: input.filters.connectorKey, ...(input.filters.readState ? { readState: input.filters.readState } : {}), ...(input.filters.emailFacets ? { facets: input.filters.emailFacets } : {}) }, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.threads.map((item) => emailMessageResultSchema.parse(item)) };
        }
        if (collectionSlug === 'email-drafts') {
          if (!input.filters?.connectorKey) throw new Error('connectorKey is required to search email drafts.');
          const output = await email.searchDrafts({ ...trusted.serviceContext, userKey: trusted.userKey }, { ...commonSearchInput, connectorKey: input.filters.connectorKey }, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.drafts.map((item) => emailDraftResultSchema.parse(item)) };
        }
        if (collectionSlug === 'places') {
          const output = await travel.searchPlaces({ ...trusted.serviceContext, query: input.query, recordHistory: false }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.places.slice(0, input.limit).map((item) => placeResultSchema.parse(item)) };
        }
        if (collectionSlug === 'trips') {
          const output = await travel.searchTrips({ ...trusted.serviceContext, query: input.query, recordHistory: false }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding });
          return { collectionSlug, results: output.trips.slice(0, input.limit).map((item) => tripResultSchema.parse(item)) };
        }
        if (collectionSlug === 'books') {
          const output = await (dependencies.books ?? defaultBookService).search({ ...trusted.serviceContext, query: input.query, minimumScore: input.minimumScore, limit: input.limit }, trusted.userKey, { queryEmbedding });
          return { collectionSlug, results: output.books.map((item) => bookResultSchema.parse(item)) };
        }
        const output = await countries.search({ organizationKey: context.organizationKey, query: input.query }, trusted.userKey, { signal: dependencies.signal, timeoutMs: dependencies.timeoutMs, queryEmbedding, recordHistory: false, minimumScore: input.minimumScore });
        return { collectionSlug, results: output.country ? [output.country] : [] };
      });

      const output = appSearchOutputSchema.parse({ query: input.query, groups: await Promise.all(groupPromises) });
      if (input.recordHistory) await (dependencies.userSearches ?? getDefaultUserSearchService()).record(trusted.userKey, input.query);
      return output;
    },
  };
}

export type AppSearchService = ReturnType<typeof createAppSearchService>;
