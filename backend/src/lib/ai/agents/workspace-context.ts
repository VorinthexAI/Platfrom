import { z } from 'zod';
import { executeAction } from '@/lib/ai/router';
import { decisionOutputSchema } from '@/lib/ai/actions/decide';
import { APP_SEARCH_COLLECTION_ADAPTERS, appSearchCollectionSlugSchema, appSearchRetrievalSchema, createAppSearchService, projectAppSearchRetrieval, type AppSearchCollectionSlug, type AppSearchRetrieval } from '@/lib/app-search/service';
import { galleryOperations, type GalleryOperationContext } from '@/lib/gallery/operations';
import { runContentTool } from '@/lib/ai/tools/content-runtime';
import { createTravelService } from '@/lib/travel/service';
import type { ConversationService } from '@/lib/conversations/service';
import { createEmailService, type EmailService } from '@/lib/email-inbox/service';
import { imageGenerationService } from '@/lib/image-generation/service';
import { scopeService } from '@/lib/ai/scopes/service';
import { sparkService } from '@/lib/sparks/service';
import { referralService } from '@/lib/referrals/service';
import { commerceService } from '@/lib/commerce/service';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import { MICRO_SPARKS_PER_SPARK } from '@/lib/costs';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

const sourceSchema = z.enum([...appSearchCollectionSlugSchema.options, 'highlights', 'memories', 'subjects', 'conversations', 'email-reply-notes', 'image-generations', 'scopes', 'billing', 'referrals', 'subscription', 'profile']);
type Source = z.infer<typeof sourceSchema>;
type Mode = 'skip' | 'inspect' | 'count';
const MAX_CONTEXT_BYTES = 90_000;
const MAX_ITEM_BYTES = 16_000;
const MAX_ITEMS = 12;
const MODES = { skip: 'The request does not need this data.', inspect: 'Read actual resources and their underlying content to answer.', count: 'An exact inventory or quantity is requested.' };
const SAFE_FIELDS = new Set(['name', 'title', 'collectionName', 'description', 'summary', 'summaries', 'versions', 'version', 'versionHistoryIncomplete', 'guides', 'references', 'topic', 'style', 'sourceTitle', 'subtitle', 'content', 'finalContent', 'generatedContent', 'instruction', 'caption', 'text', 'filename', 'mimeType', 'status', 'kind', 'role', 'city', 'country', 'countryCode', 'latitude', 'longitude', 'width', 'height', 'imageCount', 'slideCount', 'images', 'createdAt', 'updatedAt', 'lastMessageAt', 'subject', 'from', 'to', 'body', 'message', 'intent', 'priority', 'state', 'isFavorite', 'unread', 'isRead', 'email', 'estimatedMinutes', 'chapterCount', 'sizeBytes', 'count', 'position', 'goal', 'audience', 'outcome', 'language', 'progressPercent', 'chapters', 'folder', 'collections', 'trips', 'places', 'attachments', 'messages', 'thread', 'tags', 'tag', 'target', 'type', 'label', 'prompt', 'usageCount', 'generatedAt', 'sparkBalance', 'sparkDebt', 'spendingBlocked', 'bytes', 'estimatedMonthlyMicroSparks', 'sourceImageCount', 'storage', 'transactions', 'amountSparks', 'code', 'attributionCount', 'invitees', 'displayName', 'signupRewardEarned', 'firstPaidRewardStatus', 'cancelAtPeriodEnd', 'currentPeriodStart', 'currentPeriodEnd', 'billingPeriod', 'priceCents', 'currency']);

export function projectWorkspaceEvidence(value: unknown, budget = MAX_ITEM_BYTES): unknown {
  if (typeof value === 'string') return value.slice(0, budget);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => projectWorkspaceEvidence(item, Math.min(budget, 4_000)));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([field]) => SAFE_FIELDS.has(field)).map(([field, item]) => [field, projectWorkspaceEvidence(item, ['content', 'body', 'text', 'finalContent', 'generatedContent', 'instruction', 'message'].includes(field) ? budget : 2_000)]).filter(([, item]) => item !== undefined));
}

const project = projectWorkspaceEvidence;

export function materialTruncated(value: unknown, budget = MAX_ITEM_BYTES): boolean {
  if (typeof value === 'string') return value.length > budget;
  if (Array.isArray(value)) return value.length > MAX_ITEMS || value.some((item) => materialTruncated(item, Math.min(budget, 4_000)));
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([field, item]) => SAFE_FIELDS.has(field) && materialTruncated(item, ['content', 'body', 'text', 'finalContent', 'generatedContent', 'instruction', 'message'].includes(field) ? budget : 2_000)));
}

export type ContextSection = { mode: Exclude<Mode, 'skip'>; items: unknown[]; total?: number; coverage: 'complete' | 'partial' | 'unavailable'; reason?: string };
export type WorkspaceContextResult = { sections: Partial<Record<Source, ContextSection>>; coverage: { requested: Source[]; unavailable: Source[]; truncated: Source[] }; navigation?: AppSearchRetrieval[] };
export interface WorkspaceContextDependencies {
  signal?: AbortSignal;
  decide?: (state: string, questions: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
  search?: ReturnType<typeof createAppSearchService>['search'];
  billing?: typeof sparkService.getSummary;
  referrals?: typeof referralService.readSummary;
  subscription?: typeof commerceService.getCurrentSubscription;
  gallery?: Pick<typeof galleryOperations, 'listHighlights' | 'listMemories' | 'listSubjects'>;
  executeContent?: typeof runContentTool;
  travel?: Pick<ReturnType<typeof createTravelService>, 'listTripGuides' | 'listPlaceReferences'>;
  conversations?: Pick<ConversationService, 'list' | 'messages'>;
  currentConversationKey?: string;
  email?: Pick<EmailService, 'listReplyContext'>;
  generations?: Pick<typeof imageGenerationService, 'listHistory'>;
  scopes?: Pick<typeof scopeService, 'list'>;
}

/** Jev sees only the question and an allowlisted capability catalog, never account rows or identities. */
export function buildWorkspaceDecisionInput(message: string, history: readonly string[] = []) {
  const sources = sourceSchema.options;
  const questions = Object.fromEntries(sources.map((source) => [source, { type: 'choice', instructions: `Should ${source} be read to answer the user's current question? Choose count for exact quantities.`, criteria: MODES }]));
  const catalog = sources.map((source) => `${source}: ${source in APP_SEARCH_COLLECTION_ADAPTERS ? APP_SEARCH_COLLECTION_ADAPTERS[source as AppSearchCollectionSlug].description : source === 'highlights' ? 'Saved image highlights and the images they contain in accessible collections' : source === 'memories' ? 'Written memories generated from images in accessible collections' : source === 'subjects' ? 'Named visual identities and their image counts' : source === 'conversations' ? 'Previous private chats and their user and assistant messages' : source === 'email-reply-notes' ? 'Saved personal writing and reply context notes' : source === 'image-generations' ? 'Previous private image-generation prompts and usage' : source === 'scopes' ? 'The workspaces accessible to the current user' : source === 'billing' ? 'Sparks balance, storage charges, and account billing' : source === 'referrals' ? 'Personal referral and reward information' : source === 'subscription' ? 'Current subscription status, plan, renewal date, and cancellation state' : 'The authenticated user profile'}`).join('\n');
  const state = `User question: ${message.slice(0, 2_000)}\nRecent context for references: ${history.slice(-2).join(' ').slice(0, 1_000)}\nAccessible sources:\n${catalog}\nChoose all sources needed. A folder contains both documents and files. Do not infer that a title alone answers a question about its content.`;
  return { state, questions };
}

function owner(context: ToolContext) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey || principal.userTeam.userId !== principal.user.key) throw new Error('An active authorized user membership is required.');
  return principal.user;
}

function fallback(message: string): Partial<Record<Source, Mode>> {
  const result: Partial<Record<Source, Mode>> = {};
  const count = /\b(how many|count|antal|hur många|cuántos)\b/i.test(message);
  if (/\b(sparks?|balance|credits?|billing|saldo|kostnad)\b/i.test(message)) result.billing = 'inspect';
  if (/\b(referral|invite|inbjud)\b/i.test(message)) result.referrals = 'inspect';
  if (/\b(subscription|plan|abonnemang|prenumeration)\b/i.test(message)) result.subscription = 'inspect';
  if (/\b(account|profile|konto|profil)\b/i.test(message)) result.profile = 'inspect';
  for (const source of ['folders', 'documents', 'files', 'books'] as const) result[source] = count && source !== 'books' ? 'count' : 'inspect';
  return result;
}

async function enrichDetail(slug: AppSearchCollectionSlug, raw: unknown, key: string, question: string, context: ToolContext, userKey: string, dependencies: WorkspaceContextDependencies) {
  if (!raw || typeof raw !== 'object') return raw;
  const base = raw as Record<string, unknown>;
  if ((slug === 'documents' || slug === 'files') && /\b(summari(?:es|ze)?|sammanfattning(?:ar)?|versions?|historik|history|translation|översättning)\b/i.test(question)) {
    const execute = dependencies.executeContent ?? runContentTool;
    const summaries = await execute('document.list-summaries', { documentKeys: [key], limit: 10 }, context);
    const versions = await execute('document.list-versions', { documentKeys: [key], limit: 10 }, context);
    const savedSummaries = summaries.results.find((row) => row.success)?.data?.summaries ?? [];
    const history = versions.results.find((row) => row.success)?.data;
    const detailed = await Promise.all((history?.versions ?? []).slice(0, 2).map(async (version) => {
      const found = await execute('document.find-version', { versionKeys: [version.key], include: ['content'] }, context);
      return found.results.find((row) => row.success)?.data?.version ?? version;
    }));
    return { ...base, summaries: savedSummaries, versions: detailed, versionHistoryIncomplete: Boolean(history?.cursor) };
  }
  if (slug === 'trips' && /\b(guides?|itinerary|resguide|reseguide)\b/i.test(question)) {
    const guides = await (dependencies.travel ?? createTravelService()).listTripGuides({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, tripKey: key }, userKey);
    return { ...base, guides: guides.guides };
  }
  if (slug === 'places' && /\b(references?|guides?|restaurants?|activities|hotels?|accommodation|boende|restaurang)\b/i.test(question)) {
    const service = dependencies.travel ?? createTravelService();
    const kinds = ['brief', 'accommodations', 'restaurants', 'activities'] as const;
    const output = await Promise.all(kinds.map(async (kind) => {
      const result = await service.listPlaceReferences({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, placeKey: key, kind }, userKey);
      return result.references;
    }));
    return { ...base, references: output.flat() };
  }
  return raw;
}

function navigableRetrieval(input: { collectionSlugs: AppSearchCollectionSlug[]; [field: string]: unknown }, result: { groups: Array<{ results: Array<Record<string, unknown>> }> }): AppSearchRetrieval | null {
  const source = input.collectionSlugs[0];
  if (source === 'tags' || source === 'tickets' || source === 'notifications') return null;
  if (source === 'tag-assignments') {
    const targetSlugs: Record<string, AppSearchCollectionSlug> = { folder: 'folders', document: 'documents', 'image-collection': 'collections', image: 'images', place: 'places', trip: 'trips', book: 'books' };
    const groups = new Map<AppSearchCollectionSlug, Array<{ key: string; label: string }>>();
    for (const row of result.groups[0]?.results ?? []) {
      const target = row.target as { key?: unknown; type?: unknown; label?: unknown } | undefined;
      const slug = typeof target?.type === 'string' ? targetSlugs[target.type] : undefined;
      if (!slug || typeof target?.key !== 'string' || typeof target.label !== 'string') continue;
      const items = groups.get(slug) ?? [];
      items.push({ key: target.key, label: target.label.slice(0, 200) });
      groups.set(slug, items);
    }
    return groups.size ? appSearchRetrievalSchema.parse({ source: 'results', limit: 10, groups: [...groups].map(([collectionSlug, results]) => ({ collectionSlug, results })) }) : null;
  }
  const retrieval = projectAppSearchRetrieval(input, result);
  if (!retrieval) return null;
  const groups = retrieval.groups.flatMap((group) => {
    if (['tags', 'tag-assignments', 'tickets', 'notifications'].includes(group.collectionSlug)) return [];
    const results = group.results.filter((item) => !['inboxes', 'email-messages', 'email-drafts'].includes(group.collectionSlug) || Boolean(item.destinationKey || retrieval.filters?.connectorKey));
    return results.length ? [{ ...group, results }] : [];
  });
  return groups.length ? appSearchRetrievalSchema.parse({ ...retrieval, groups }) : null;
}

export async function gatherWorkspaceContext(message: string, context: ToolContext, dependencies: WorkspaceContextDependencies = {}, history: readonly string[] = []): Promise<WorkspaceContextResult> {
  const user = owner(context);
  const sources = sourceSchema.options;
  const { state, questions } = buildWorkspaceDecisionInput(message, history);
  const query = `${history.slice(-2).join(' ')} ${message}`.trim().slice(0, 500);
  let modes: Partial<Record<Source, Mode>>;
  try {
    const raw = dependencies.decide ? await dependencies.decide(state, questions, context) : (await executeAction({ mode: 'auto', teamKey: context.teamKey, actionSlug: 'decide' }, { state, questions }, { timeoutMs: 2_000, signal: dependencies.signal })).output;
    const answers = decisionOutputSchema.parse(raw).answers;
    modes = Object.fromEntries(sources.map((source) => [source, answers[source]?.choice]).filter((entry): entry is [Source, Mode] => typeof entry[1] === 'string' && entry[1] in MODES)) as Partial<Record<Source, Mode>>;
    if (Object.keys(modes).length !== sources.length) throw new Error('Incomplete classifier response.');
  } catch (error) {
    dependencies.signal?.throwIfAborted();
    console.warn('workspace context decision fallback', { errorName: error instanceof Error ? error.name : 'unknown' });
    modes = fallback(message);
  }
  // A classifier can miss a plainly named domain even with high confidence.
  // These lexical anchors only add read access to already-authorized services.
  if (/\b(sparks?|balance|credits?|billing|saldo|kostnad)\b/i.test(message)) modes.billing = 'inspect';
  if (/\b(audio\s?books?|books?|ljudb(o|ö)cker|ljudbok|libro|böcker|bok)\b/i.test(message)) modes.books = 'inspect';
  if (/\b(folders?|mapp|mappar|carpeta|directory)\b/i.test(message)) modes.folders = modes.folders === 'count' ? 'count' : 'inspect';
  if (/\b(documents?|dokument|notes?|anteckningar|scans?|scannade)\b/i.test(message)) modes.documents = modes.documents === 'count' ? 'count' : 'inspect';
  if (/\b(files?|filer|pdfs?|uploads?)\b/i.test(message)) modes.files = modes.files === 'count' ? 'count' : 'inspect';
  if (/\b(email|mail|messages?|mejl|correo|inbox|inkorg)\b/i.test(message) && modes.inboxes && modes.inboxes !== 'skip') modes['email-messages'] = 'inspect';
  if (/\b(drafts?|utkast|borrador)\b/i.test(message)) modes['email-drafts'] = modes['email-drafts'] === 'count' ? 'count' : 'inspect';
  if (/\b(images?|photos?|pictures?|bilder|foton)\b/i.test(message) && modes.collections && modes.collections !== 'skip') modes.images = 'inspect';
  if (/\b(highlights?|höjdpunkter)\b/i.test(message)) modes.highlights = modes.highlights === 'count' ? 'count' : 'inspect';
  if (/\b(memories|memory|minnen|minne)\b/i.test(message)) modes.memories = modes.memories === 'count' ? 'count' : 'inspect';
  if (/\b(subjects?|identit(?:y|ies)|personer|person)\b/i.test(message)) modes.subjects = modes.subjects === 'count' ? 'count' : 'inspect';
  if (/\b(trips?|resa|resor|itinerary|travel guide)\b/i.test(message)) modes.trips = modes.trips === 'count' ? 'count' : 'inspect';
  if (/\b(places?|destination|ställen|platser|restaurants?|activities|hotels?)\b/i.test(message)) modes.places = modes.places === 'count' ? 'count' : 'inspect';
  if (/\b(referral|invite|inbjud)\b/i.test(message)) modes.referrals = 'inspect';
  if (/\b(subscription|plan|abonnemang|prenumeration)\b/i.test(message)) modes.subscription = 'inspect';
  if (/\b(conversations?|chats?|samtal|diskuterade|discussed)\b/i.test(message)) modes.conversations = modes.conversations === 'count' ? 'count' : 'inspect';
  if (/\b(reply context|writing notes?|svarskontext|skrivstil)\b/i.test(message)) modes['email-reply-notes'] = 'inspect';
  if (/\b(generation history|generated prompts?|bildprompter)\b/i.test(message)) modes['image-generations'] = 'inspect';
  if (/\b(workspaces?|scope|arbetsytor)\b/i.test(message)) modes.scopes = modes.scopes === 'count' ? 'count' : 'inspect';
  if (/\b(how many|count|antal|hur många|cuántos)\b/i.test(message)) {
    for (const source of sourceSchema.options) if (modes[source] === 'inspect' && source in APP_SEARCH_COLLECTION_ADAPTERS && (APP_SEARCH_COLLECTION_ADAPTERS[source as AppSearchCollectionSlug].operations as readonly string[]).includes('count')) modes[source] = 'count';
    for (const source of ['highlights', 'memories', 'subjects'] as const) if (modes[source] === 'inspect') modes[source] = 'count';
    for (const source of ['conversations', 'email-reply-notes', 'image-generations', 'scopes'] as const) if (modes[source] === 'inspect') modes[source] = 'count';
  }
  if (sourceSchema.options.every((source) => !modes[source] || modes[source] === 'skip') && /\b(my|mine|me|jag|mina|mitt|mis|mio)\b/i.test(message)) modes = fallback(message);
  if (modes.folders !== 'skip' && modes.folders && /\b(folder|mapp|carpeta|directory|document|file|dokument|fil)\b/i.test(message)) {
    modes.documents = modes.folders === 'count' ? 'count' : 'inspect';
    modes.files = modes.folders === 'count' ? 'count' : 'inspect';
  }
  const selected = sources.filter((source) => modes[source] && modes[source] !== 'skip');
  const search = dependencies.search ?? createAppSearchService().search;
  const sections: WorkspaceContextResult['sections'] = {};
  const unavailable: Source[] = [], truncated: Source[] = [];
  const navigation: Array<{ source: Source; value: AppSearchRetrieval }> = [];
  const matchedFolder = async () => {
    const output = await search({ query, collectionSlugs: ['folders'], limit: 8, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ key: string; name: string }> }> };
    const folders = output.groups[0]?.results ?? [];
    const exact = folders.filter((folder) => query.toLocaleLowerCase().includes(folder.name.toLocaleLowerCase()));
    const longest = Math.max(0, ...exact.map(({ name }) => name.length));
    const mostSpecific = exact.filter(({ name }) => name.length === longest);
    return { folder: mostSpecific[0], ambiguous: mostSpecific.length > 1 };
  };
  const folderRequested = /\b(folder|mapp|carpeta|directory)\b/i.test(message);
  const folderPromise = selected.some((source) => ['folders', 'documents', 'files'].includes(source)) && folderRequested ? matchedFolder().catch(() => undefined) : Promise.resolve(undefined);
  const inboxRequested = /\b(inbox|mailbox|inkorg|postlåda|mailkonto)\b/i.test(message);
  const inboxPromise = selected.some((source) => ['email-messages', 'email-drafts'].includes(source)) && inboxRequested
    ? search({ query, collectionSlugs: ['inboxes'], limit: 8, recordHistory: false }, context, { signal: dependencies.signal }).then((output) => {
      const rows = (output as { groups: Array<{ results: Array<{ connectorKey: string; name: string; email?: string }> }> }).groups[0]?.results ?? [];
      const exact = rows.filter((row) => [row.name, row.email].some((value) => value && query.toLocaleLowerCase().includes(value.toLocaleLowerCase())));
      return { key: exact[0]?.connectorKey, ambiguous: exact.length > 1 };
    }).catch(() => undefined) : Promise.resolve(undefined);
  const collectionRequested = /\b(album|collection|samling)\b/i.test(message);
  const collectionPromise = selected.some((source) => ['images', 'highlights', 'memories'].includes(source)) && collectionRequested
    ? search({ query, collectionSlugs: ['collections'], limit: 8, recordHistory: false }, context, { signal: dependencies.signal }).then((output) => {
      const rows = (output as { groups: Array<{ results: Array<{ key: string; name: string }> }> }).groups[0]?.results ?? [];
      const exact = rows.filter((row) => query.toLocaleLowerCase().includes(row.name.toLocaleLowerCase()));
      return { key: exact[0]?.key, name: exact[0]?.name, ambiguous: exact.length > 1 };
    }).catch(() => undefined) : Promise.resolve(undefined);
  const readSource = async (source: Source) => {
    const mode = modes[source]! as Exclude<Mode, 'skip'>;
    try {
      if (source === 'billing') {
        const value = await (dependencies.billing ?? sparkService.getSummary)(user.key, { limit: 10 });
        sections[source] = { mode, items: [project({ sparkBalance: value.microSparkBalance / MICRO_SPARKS_PER_SPARK, sparkDebt: value.microSparkDebt / MICRO_SPARKS_PER_SPARK, spendingBlocked: value.spendingBlocked, storage: value.storage, transactions: value.transactions.map((item) => ({ kind: item.kind, amountSparks: item.deltaMicroSparks / MICRO_SPARKS_PER_SPARK, createdAt: item.createdAt })) })], coverage: 'complete' }; return;
      }
      if (source === 'referrals') {
        const value = await (dependencies.referrals ?? referralService.readSummary)(user.key);
        sections[source] = { mode, items: [project(value)], coverage: 'complete' }; return;
      }
      if (source === 'subscription') {
        const value = await (dependencies.subscription ?? commerceService.getCurrentSubscription)(user.key);
        const product = COMMERCE_CATALOG.find(({ key }) => key === value?.productKey);
        sections[source] = { mode, items: [value ? project({ status: value.status, cancelAtPeriodEnd: value.cancelAtPeriodEnd, currentPeriodStart: value.currentPeriodStart, currentPeriodEnd: value.currentPeriodEnd, ...(product ? { billingPeriod: product.billingPeriod, priceCents: product.discountedPriceCents ?? product.priceCents, currency: product.currency } : {}) }) : { status: 'none' }], coverage: 'complete' }; return;
      }
      if (source === 'profile') {
        sections[source] = { mode, items: [project({ name: user.name, email: user.email, countryCode: user.countryCode })], coverage: 'complete' }; return;
      }
      if (source === 'conversations') {
        const service = dependencies.conversations ?? (await import('@/lib/conversations/service')).createConversationService();
        const output = await service.list({ limit: mode === 'count' ? 100 : 25 }, context);
        const complete = !output.nextCursor;
        if (mode === 'count') {
          sections[source] = { mode, items: [], ...(complete ? { total: output.items.length } : {}), coverage: complete ? 'complete' : 'partial' };
          if (!complete) truncated.push(source);
          return;
        }
        const candidates = output.items.filter(({ key }) => key !== dependencies.currentConversationKey);
        const named = candidates.filter(({ name }) => query.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
        const selectedChats = (named.length ? named : candidates).slice(0, 2);
        const items = await Promise.all(selectedChats.map(async (chat) => {
          const page = await service.messages({ conversationKey: chat.key, limit: 10 }, context);
          return project({ name: chat.name, updatedAt: chat.updatedAt, messages: page.items.filter((entry) => entry.status === 'COMPLETED').map(({ role, content, createdAt }) => ({ role, content, createdAt })) });
        }));
        const partial = !complete || selectedChats.length < candidates.length;
        sections[source] = { mode, items, coverage: partial ? 'partial' : 'complete', ...(partial ? { reason: 'Only recent authorized chats were included.' } : {}) };
        if (partial) truncated.push(source);
        return;
      }
      if (source === 'email-reply-notes' || source === 'image-generations' || source === 'scopes') {
        const rows = source === 'email-reply-notes' ? await (dependencies.email ?? createEmailService()).listReplyContext({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey: user.key })
          : source === 'image-generations' ? (await (dependencies.generations ?? imageGenerationService).listHistory({ limit: 50 }, context)).generations
          : (await (dependencies.scopes ?? scopeService).list({}, context)).scopes;
        const complete = source !== 'image-generations' || rows.length < 50;
        if (mode === 'count') {
          sections[source] = { mode, items: [], ...(complete ? { total: rows.length } : {}), coverage: complete ? 'complete' : 'partial' };
          if (!complete) truncated.push(source);
        } else {
          const items = rows.slice(0, 4).map((row) => project(row));
          const partial = !complete || rows.length > items.length;
          sections[source] = { mode, items, coverage: partial ? 'partial' : 'complete' };
          if (partial) truncated.push(source);
        }
        return;
      }
      if (source === 'highlights' || source === 'memories' || source === 'subjects') {
        const membership = context.principal.kind === 'member' ? context.principal.userTeam : undefined;
        if (!membership) throw new Error('Gallery membership is unavailable.');
        const galleryContext = { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, membership, signal: dependencies.signal } as GalleryOperationContext;
        const gallery = dependencies.gallery ?? galleryOperations;
        const selectedCollection = source === 'subjects' ? undefined : await collectionPromise;
        if (collectionRequested && source !== 'subjects' && (!selectedCollection?.key || selectedCollection.ambiguous)) {
          sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'The requested collection could not be uniquely resolved.' };
          unavailable.push(source); return;
        }
        let rows: Array<Record<string, unknown>> = [];
        let inventoryComplete = true;
        if (source === 'highlights') {
          const result = await gallery.listHighlights(selectedCollection?.key ? { collectionKey: selectedCollection.key } : {}, galleryContext);
          rows = result.highlights.map((item) => ({ ...item, title: `Highlight ${item.createdAt.slice(0, 10)}`, slideCount: item.images.length }));
        } else if (source === 'subjects') {
          rows = (await gallery.listSubjects({}, galleryContext)).subjects;
        } else {
          const result = selectedCollection?.key ? { groups: [{ results: [{ key: selectedCollection.key, name: selectedCollection.name ?? '' }] }] }
            : await search({ operation: 'list', collectionSlugs: ['collections'], limit: 50, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ key: string; name: string }> }> };
          const collections = result.groups[0]?.results ?? [];
          inventoryComplete = Boolean(selectedCollection?.key) || collections.length < 50;
          const batches = [];
          for (let index = 0; index < collections.length; index += 4) batches.push(...await Promise.allSettled(collections.slice(index, index + 4).map(async (collection) => {
            const memories = (await gallery.listMemories({ collectionKey: collection.key }, galleryContext)).memories;
            return memories.map((memory) => ({ ...memory, collectionKey: collection.key, collectionName: collection.name, title: `Memory ${memory.createdAt.slice(0, 10)}` }));
          })));
          inventoryComplete = inventoryComplete && batches.every((batch) => batch.status === 'fulfilled');
          rows = batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : []);
        }
        if (mode === 'count') {
          sections[source] = { mode, items: [], total: inventoryComplete ? rows.length : undefined, coverage: inventoryComplete ? 'complete' : 'partial', ...(!inventoryComplete ? { reason: 'Some accessible collections could not be counted.' } : {}) };
          if (!inventoryComplete) truncated.push(source);
          return;
        }
        const ranked = rows.filter((item) => [item.title, item.name, item.description, item.text, item.collectionName].some((value) => typeof value === 'string' && query.toLocaleLowerCase().includes(value.toLocaleLowerCase())));
        const chosen = (ranked.length ? ranked : rows).slice(0, 4);
        const navigationResults = chosen.flatMap((item) => typeof item.key === 'string' && (source === 'subjects' || typeof item.collectionKey === 'string') ? [{ key: item.key, label: String(item.title ?? item.name ?? 'Result').slice(0, 200), ...(source !== 'subjects' ? { destinationKey: item.collectionKey as string } : {}) }] : []);
        if (navigationResults.length) navigation.push({ source, value: appSearchRetrievalSchema.parse({ source: 'results', limit: 10, groups: [{ collectionSlug: source, results: navigationResults }] }) });
        const partial = source === 'highlights' || !inventoryComplete || chosen.length < rows.length || chosen.some((item) => materialTruncated(item));
        sections[source] = { mode, items: chosen.map((item) => project(item)), coverage: partial ? 'partial' : 'complete', ...(partial ? { reason: source === 'highlights' ? 'Highlight captions were read; image pixels were not inspected.' : 'Only some accessible artifacts could be included.' } : {}) };
        if (partial) truncated.push(source);
        return;
      }
      const slug = source as AppSearchCollectionSlug;
      const folderResult = ['folders', 'documents', 'files'].includes(slug) ? await folderPromise : undefined;
      const folder = folderResult?.folder;
      if (folderRequested && (slug === 'documents' || slug === 'files') && (!folder || folderResult?.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: folderResult?.ambiguous ? 'Several folders matched the name.' : 'The requested folder could not be resolved.' };
        unavailable.push(source); return;
      }
      const inbox = (slug === 'email-messages' || slug === 'email-drafts') ? await inboxPromise : undefined;
      const allInboxes = /\b(my inbox|my mailboxes|mina inkorgar|mina mejl)\b/i.test(message);
      if (inboxRequested && !allInboxes && (slug === 'email-messages' || slug === 'email-drafts') && (!inbox?.key || inbox.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'The requested inbox could not be uniquely resolved.' };
        unavailable.push(source); return;
      }
      const collection = slug === 'images' ? await collectionPromise : undefined;
      if (collectionRequested && slug === 'images' && (!collection?.key || collection.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'The requested collection could not be uniquely resolved.' };
        unavailable.push(source); return;
      }
      const filters = folder && slug !== 'folders' ? { folderKey: folder.key, includeDescendants: true } : inbox?.key && !allInboxes ? { connectorKey: inbox.key } : collection?.key ? { collectionKey: collection.key } : undefined;
      if (mode === 'count' && (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('count')) {
        if ((slug === 'email-messages' || slug === 'email-drafts') && !filters) {
          const available = await search({ operation: 'list', collectionSlugs: ['inboxes'], limit: 50, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ connectorKey: string }> }> };
          const accounts = available.groups[0]?.results ?? [];
          let count = 0;
          for (let offset = 0; offset < accounts.length; offset += 4) {
            const values = await Promise.all(accounts.slice(offset, offset + 4).map(({ connectorKey }) => search({ operation: 'count', collectionSlugs: [slug], filters: { connectorKey }, recordHistory: false }, context, { signal: dependencies.signal }) as Promise<{ groups: Array<{ count: number }> }>));
            count += values.reduce((sum, result) => sum + (result.groups[0]?.count ?? 0), 0);
          }
          const complete = accounts.length < 50;
          sections[source] = { mode, items: [], total: complete ? count : undefined, coverage: complete ? 'complete' : 'partial', ...(!complete ? { reason: 'Additional inboxes may not have been counted.' } : {}) };
          if (!complete) truncated.push(source);
          return;
        }
        const result = await search({ operation: 'count', collectionSlugs: [slug], ...(filters ? { filters } : {}), recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ count: number }> };
        sections[source] = { mode, items: [], total: result.groups[0]?.count ?? 0, coverage: 'complete' }; return;
      }
      const supportsList = (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('list');
      const useList = supportsList && (mode === 'count' || Boolean(filters) || !(APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('search') || (slug === 'books' && /\b(this|my|the|den|min)\b/i.test(message)));
      const input = useList
        ? { operation: 'list', collectionSlugs: [slug], limit: 20, ...(filters ? { filters } : {}), recordHistory: false }
        : { query, collectionSlugs: [slug], limit: 8, ...(filters ? { filters } : {}), recordHistory: false };
      const result = await search(input, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<Record<string, unknown>> }> };
      const rawFound = result.groups[0]?.results ?? [];
      const found = useList ? rawFound : rawFound.filter((item) => typeof item.score !== 'number' || item.score >= 0.35 || [item.name, item.title, item.subject, item.caption].some((name) => typeof name === 'string' && query.toLocaleLowerCase().includes(name.toLocaleLowerCase())));
      if (found.length) {
        try { const value = navigableRetrieval(input, { ...result, groups: result.groups.map((group) => ({ ...group, results: group.results.filter((item) => found.includes(item)) })) }); if (value) navigation.push({ source, value }); } catch { /* Navigation never affects the answer. */ }
      }
      const exact = found.filter((item) => [item.name, item.title, item.subject].some((name) => typeof name === 'string' && query.toLocaleLowerCase().includes(name.toLocaleLowerCase())));
      const selectedItems = (exact.length ? exact : found).slice(0, 4);
      let deepTruncated = false;
      const items = await Promise.all(selectedItems.map(async (item) => {
        if (typeof item.key === 'string' && ['books', 'documents', 'files', 'email-messages', 'folders'].includes(slug) && (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('get')) {
          try {
            const detail = await search({ operation: 'get', collectionSlugs: [slug], key: item.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> };
            const value = await enrichDetail(slug, detail.groups[0]?.results[0] ?? item, item.key, query, context, user.key, dependencies);
            if (materialTruncated(value)) deepTruncated = true;
            return project(value);
          } catch { dependencies.signal?.throwIfAborted(); deepTruncated = true; /* Keep authorized discovery evidence when a detail read fails. */ }
        }
        if (typeof item.key === 'string' && (slug === 'trips' || slug === 'places')) {
          const value = await enrichDetail(slug, item, item.key, query, context, user.key, dependencies);
          if (materialTruncated(value)) deepTruncated = true;
          return project(value);
        }
        if (materialTruncated(item)) deepTruncated = true;
        return project(item);
      }));
      const countUnavailable = mode === 'count';
      const partial = countUnavailable || slug === 'images' || deepTruncated || !useList && !found.length || rawFound.length >= (useList ? 20 : 8) || selectedItems.length < found.length;
      sections[source] = { mode, items, coverage: partial ? 'partial' : 'complete', ...(partial ? { reason: countUnavailable ? 'This source cannot provide an exact count.' : slug === 'images' ? 'Image descriptions and metadata were read; pixels were not inspected.' : !useList && !found.length ? 'No search matches; this does not establish absence.' : 'Only the most relevant resources were included.' } : {}) };
      if (partial) truncated.push(source);
    } catch {
      dependencies.signal?.throwIfAborted();
      sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'This source could not be checked.' };
      unavailable.push(source);
    }
  };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (cursor < selected.length) await readSource(selected[cursor++]!);
  }));
  // Bound total model-facing JSON without ever inserting raw service rows or keys.
  let total = 0;
  for (const source of selected) {
    const section = sections[source];
    if (!section) continue;
    const size = Buffer.byteLength(JSON.stringify(section), 'utf8');
    if (total + size > MAX_CONTEXT_BYTES) {
      sections[source] = { mode: section.mode, items: [], coverage: 'partial', reason: 'Context budget was reached.' };
      if (!truncated.includes(source)) truncated.push(source);
    } else total += size;
  }
  const priority = ({ source, value }: (typeof navigation)[number]) => {
    const aliases: Partial<Record<Source, RegExp>> = { highlights: /\bhighlights?\b/i, memories: /\bmemor(?:y|ies)\b/i, subjects: /\bsubjects?\b/i, documents: /\bdocuments?\b/i, files: /\bfiles?\b/i, folders: /\bfolders?\b/i, images: /\bimages?\b/i, collections: /\b(collection|album)\b/i, books: /\b(audio\s?book|books?)\b/i, trips: /\btrips?\b/i, places: /\bplaces?\b/i };
    return (aliases[source]?.test(message) ? 10 : 0) + (value.groups.some((group) => group.results.some(({ label }) => label.length > 2 && query.toLocaleLowerCase().includes(label.toLocaleLowerCase()))) ? 5 : 0);
  };
  const orderedNavigation = navigation.sort((a, b) => priority(b) - priority(a)).slice(0, 4).map(({ value }) => value);
  return { sections, coverage: { requested: selected, unavailable, truncated }, ...(orderedNavigation.length ? { navigation: orderedNavigation } : {}) };
}
