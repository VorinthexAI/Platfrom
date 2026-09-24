import { z } from 'zod';
import { executeAction } from '@/lib/ai/router';
import { decisionOutputSchema } from '@/lib/ai/actions/decide';
import { APP_SEARCH_COLLECTION_ADAPTERS, appSearchCollectionSlugSchema, createAppSearchService, projectAppSearchRetrieval, type AppSearchCollectionSlug, type AppSearchRetrieval } from '@/lib/app-search/service';
import { sparkService } from '@/lib/sparks/service';
import { referralService } from '@/lib/referrals/service';
import { commerceService } from '@/lib/commerce/service';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import { MICRO_SPARKS_PER_SPARK } from '@/lib/costs';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

const sourceSchema = z.enum([...appSearchCollectionSlugSchema.options, 'billing', 'referrals', 'subscription', 'profile']);
type Source = z.infer<typeof sourceSchema>;
type Mode = 'skip' | 'inspect' | 'count';
const MAX_CONTEXT_BYTES = 90_000;
const MAX_ITEM_BYTES = 16_000;
const MAX_ITEMS = 12;
const MODES = { skip: 'The request does not need this data.', inspect: 'Read actual resources and their underlying content to answer.', count: 'An exact inventory or quantity is requested.' };
const SAFE_FIELDS = new Set(['name', 'title', 'description', 'summary', 'subtitle', 'content', 'finalContent', 'generatedContent', 'instruction', 'caption', 'filename', 'mimeType', 'status', 'kind', 'role', 'city', 'country', 'countryCode', 'latitude', 'longitude', 'createdAt', 'updatedAt', 'lastMessageAt', 'subject', 'from', 'to', 'body', 'message', 'intent', 'priority', 'state', 'isFavorite', 'unread', 'isRead', 'email', 'estimatedMinutes', 'chapterCount', 'sizeBytes', 'count', 'position', 'goal', 'audience', 'outcome', 'language', 'progressPercent', 'chapters', 'folder', 'collections', 'trips', 'places', 'messages', 'thread', 'tags', 'tag', 'target', 'type', 'label', 'sparkBalance', 'sparkDebt', 'spendingBlocked', 'bytes', 'estimatedMonthlyMicroSparks', 'sourceImageCount', 'storage', 'transactions', 'amountSparks', 'code', 'attributionCount', 'invitees', 'displayName', 'signupRewardEarned', 'firstPaidRewardStatus', 'cancelAtPeriodEnd', 'currentPeriodStart', 'currentPeriodEnd', 'billingPeriod', 'priceCents', 'currency']);

function project(value: unknown, budget = MAX_ITEM_BYTES): unknown {
  if (typeof value === 'string') return value.slice(0, budget);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => project(item, Math.min(budget, 4_000)));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).filter(([field]) => SAFE_FIELDS.has(field)).map(([field, item]) => [field, project(item, ['content', 'body', 'finalContent', 'generatedContent', 'instruction', 'message'].includes(field) ? budget : 2_000)]).filter(([, item]) => item !== undefined));
}

function materialTruncated(value: unknown, budget = MAX_ITEM_BYTES): boolean {
  if (typeof value === 'string') return value.length > budget;
  if (Array.isArray(value)) return value.length > MAX_ITEMS || value.some((item) => materialTruncated(item, Math.min(budget, 4_000)));
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([field, item]) => SAFE_FIELDS.has(field) && materialTruncated(item, ['content', 'body', 'finalContent', 'generatedContent', 'instruction', 'message'].includes(field) ? budget : 2_000)));
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

export async function gatherWorkspaceContext(message: string, context: ToolContext, dependencies: WorkspaceContextDependencies = {}, history: readonly string[] = []): Promise<WorkspaceContextResult> {
  const user = owner(context);
  const sources = sourceSchema.options;
  const questions = Object.fromEntries(sources.map((source) => [source, { type: 'choice', instructions: `Should ${source} be read to answer the user's current question? Choose count for exact quantities.`, criteria: MODES }]));
  const catalog = sources.map((source) => `${source}: ${source in APP_SEARCH_COLLECTION_ADAPTERS ? APP_SEARCH_COLLECTION_ADAPTERS[source as AppSearchCollectionSlug].description : source === 'billing' ? 'Sparks balance, storage charges, and account billing' : source === 'referrals' ? 'Personal referral and reward information' : source === 'subscription' ? 'Current subscription status, plan, renewal date, and cancellation state' : 'The authenticated user profile'}`).join('\n');
  const query = `${history.slice(-2).join(' ')} ${message}`.trim().slice(0, 500);
  const state = `User question: ${message.slice(0, 2_000)}\nRecent context for references: ${history.slice(-2).join(' ').slice(0, 1_000)}\nAccessible sources:\n${catalog}\nChoose all sources needed. A folder contains both documents and files. Do not infer that a title alone answers a question about its content.`;
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
  if (/\b(referral|invite|inbjud)\b/i.test(message)) modes.referrals = 'inspect';
  if (/\b(subscription|plan|abonnemang|prenumeration)\b/i.test(message)) modes.subscription = 'inspect';
  if (/\b(how many|count|antal|hur många|cuántos)\b/i.test(message)) {
    for (const source of sourceSchema.options) if (modes[source] === 'inspect' && source in APP_SEARCH_COLLECTION_ADAPTERS && (APP_SEARCH_COLLECTION_ADAPTERS[source as AppSearchCollectionSlug].operations as readonly string[]).includes('count')) modes[source] = 'count';
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
  const navigation: AppSearchRetrieval[] = [];
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
  const collectionPromise = selected.includes('images') && collectionRequested
    ? search({ query, collectionSlugs: ['collections'], limit: 8, recordHistory: false }, context, { signal: dependencies.signal }).then((output) => {
      const rows = (output as { groups: Array<{ results: Array<{ key: string; name: string }> }> }).groups[0]?.results ?? [];
      const exact = rows.filter((row) => query.toLocaleLowerCase().includes(row.name.toLocaleLowerCase()));
      return { key: exact[0]?.key, ambiguous: exact.length > 1 };
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
      const slug = source as AppSearchCollectionSlug;
      const folderResult = ['folders', 'documents', 'files'].includes(slug) ? await folderPromise : undefined;
      const folder = folderResult?.folder;
      if (folderRequested && (slug === 'documents' || slug === 'files') && (!folder || folderResult?.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: folderResult?.ambiguous ? 'Several folders matched the name.' : 'The requested folder could not be resolved.' };
        unavailable.push(source); return;
      }
      const inbox = (slug === 'email-messages' || slug === 'email-drafts') ? await inboxPromise : undefined;
      if (inboxRequested && (slug === 'email-messages' || slug === 'email-drafts') && (!inbox?.key || inbox.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'The requested inbox could not be uniquely resolved.' };
        unavailable.push(source); return;
      }
      const collection = slug === 'images' ? await collectionPromise : undefined;
      if (collectionRequested && slug === 'images' && (!collection?.key || collection.ambiguous)) {
        sections[source] = { mode, items: [], coverage: 'unavailable', reason: 'The requested collection could not be uniquely resolved.' };
        unavailable.push(source); return;
      }
      const filters = folder && slug !== 'folders' ? { folderKey: folder.key, includeDescendants: true } : inbox?.key ? { connectorKey: inbox.key } : collection?.key ? { collectionKey: collection.key } : undefined;
      if (mode === 'count' && (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('count')) {
        const result = await search({ operation: 'count', collectionSlugs: [slug], ...(filters ? { filters } : {}), recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ count: number }> };
        sections[source] = { mode, items: [], total: result.groups[0]?.count ?? 0, coverage: 'complete' }; return;
      }
      const supportsList = (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('list');
      const useList = supportsList && (mode === 'count' || Boolean(filters) || !(APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('search') || (slug === 'books' && /\b(this|my|the|den|min)\b/i.test(message)));
      const input = useList
        ? { operation: 'list', collectionSlugs: [slug], limit: 20, ...(filters ? { filters } : {}), recordHistory: false }
        : { query, collectionSlugs: [slug], limit: 8, ...(filters ? { filters } : {}), recordHistory: false };
      const result = await search(input, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<Record<string, unknown>> }> };
      if (navigation.length < 4) {
        try { const value = projectAppSearchRetrieval(input, result); if (value) navigation.push(value); } catch { /* Navigation never affects the answer. */ }
      }
      const found = result.groups[0]?.results ?? [];
      const exact = found.filter((item) => [item.name, item.title, item.subject].some((name) => typeof name === 'string' && query.toLocaleLowerCase().includes(name.toLocaleLowerCase())));
      const selectedItems = (exact.length ? exact : found).slice(0, 4);
      let deepTruncated = false;
      const items = await Promise.all(selectedItems.map(async (item) => {
        if (typeof item.key === 'string' && ['books', 'documents', 'files', 'email-messages', 'folders'].includes(slug) && (APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[]).includes('get')) {
          try {
            const detail = await search({ operation: 'get', collectionSlugs: [slug], key: item.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> };
            const value = detail.groups[0]?.results[0] ?? item;
            if (materialTruncated(value)) deepTruncated = true;
            return project(value);
          } catch { dependencies.signal?.throwIfAborted(); /* Keep authorized discovery evidence when a detail read fails. */ }
        }
        if (materialTruncated(item)) deepTruncated = true;
        return project(item);
      }));
      const countUnavailable = mode === 'count';
      const partial = countUnavailable || slug === 'images' || deepTruncated || !useList && !found.length || found.length >= (useList ? 20 : 8) || selectedItems.length < found.length;
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
  return { sections, coverage: { requested: selected, unavailable, truncated }, ...(navigation.length ? { navigation: navigation.slice(0, 4) } : {}) };
}
