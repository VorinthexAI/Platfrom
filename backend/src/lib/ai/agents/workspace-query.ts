import { createAppSearchService, APP_SEARCH_COLLECTION_ADAPTERS, appSearchRetrievalSchema, projectAppSearchModelResult, projectAppSearchRetrieval, type AppSearchCollectionSlug, type AppSearchRetrieval, type AppSearchRetrievalCollectionSlug } from '@/lib/app-search/service';
import { findWorkspaceGraph, type GraphHit } from '@/lib/app-search/graph-query';
import { galleryOperations, type GalleryOperationContext } from '@/lib/gallery/operations';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { projectWorkspaceEvidence, materialTruncated } from './workspace-context';
import { createTravelService } from '@/lib/travel/service';
import { createEmailService } from '@/lib/email-inbox/service';
import { agentQueryInputSchema } from './workspace-query-schema';
import { SparkRefundError } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';
export { agentQueryInputSchema } from './workspace-query-schema';
export type { AgentQueryInput } from './workspace-query-schema';

const sources: Partial<Record<GraphHit['source'], AppSearchCollectionSlug>> = {
  folders: 'folders', documents: 'documents', collections: 'collections', images: 'images', emailInboxes: 'inboxes', emailThreads: 'email-messages', emailMessages: 'email-messages', emailDrafts: 'email-drafts', emailTones: 'email-tones', places: 'places', trips: 'trips', books: 'books',
  tags: 'tags', tickets: 'tickets', userNotifications: 'notifications',
};

type NamedRow = Record<string, unknown> & { key: string };
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
const displayName = (row: Record<string, unknown>) => [row.name, row.title, row.subject, row.filename, row.caption].find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
function namesInQuestion(rows: NamedRow[], question: string) {
  const text = normalized(question);
  return rows.filter((row) => { const name = displayName(row); return name && text.includes(normalized(name)); });
}
function bestNamedCandidate(rows: NamedRow[], question: string, minimumScore = 1) {
  const text = normalized(question);
  const scored = rows.map((row) => ({ row, score: (displayName(row)?.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2 && text.includes(normalized(word))).length }));
  const best = Math.max(0, ...scored.map(({ score }) => score));
  const matches = scored.filter(({ score }) => score === best && score >= minimumScore);
  return matches.length === 1 ? matches[0]!.row : undefined;
}
const discoveryFamilies: Record<GraphHit['source'], string> = {
  folders: 'content', documents: 'content', tags: 'content', collections: 'media', images: 'media', imageCollectionMemories: 'media', visualIdentities: 'media',
  emailInboxes: 'communication', emailThreads: 'communication', emailMessages: 'communication', emailDrafts: 'communication', emailTones: 'communication', emailReplyContext: 'communication', userNotifications: 'communication', tickets: 'communication',
  places: 'travel', trips: 'travel', tripGuides: 'travel', placeReferences: 'travel', books: 'learning', bookChapters: 'learning',
};

export interface WorkspaceQueryDependencies {
  search?: ReturnType<typeof createAppSearchService>['search'];
  find?: typeof findWorkspaceGraph;
  gallery?: Pick<typeof galleryOperations, 'listMemories' | 'listHighlights' | 'listSubjects' | 'readMemory'>;
  travel?: Pick<ReturnType<typeof createTravelService>, 'listTripGuides' | 'listPlaceReferences'>;
  email?: Pick<ReturnType<typeof createEmailService>, 'listReplyContext' | 'overview'>;
  message?: string;
  expandRelated?: boolean;
  recent?: AppSearchRetrieval[];
  onEvidence?: (values: AppSearchRetrieval[]) => void;
  signal?: AbortSignal;
}

/** All candidate keys are resolved against canonical authorized services before use. */
export async function queryWorkspace(raw: unknown, context: ToolContext, dependencies: WorkspaceQueryDependencies = {}) {
  const input = agentQueryInputSchema.parse(raw);
  if (context.principal.kind !== 'member' || context.principal.userTeam.status !== 'active' || context.principal.userTeam.userId !== context.principal.user.key || context.principal.userTeam.teamKey !== context.teamKey) throw new Error('Active membership required.');
  const membership = context.principal.userTeam;
  const userKey = context.principal.user.key;
  const search = dependencies.search ?? createAppSearchService().search;
  const find = dependencies.find ?? findWorkspaceGraph;
  const graph = dependencies.gallery ?? galleryOperations;
  const question = dependencies.message?.trim() ?? '';
  const navigation: Array<{ value: AppSearchRetrieval; priority: number }> = [];
  const remember = (slug: AppSearchRetrievalCollectionSlug, key: string, label: string, destinationKey?: string, priority = 2) => {
    const parsed = appSearchRetrievalSchema.safeParse({ source: 'results', limit: 10, groups: [{ collectionSlug: slug, results: [{ key, label: label.slice(0, 200), ...(destinationKey ? { destinationKey } : {}) }] }] });
    if (parsed.success) navigation.push({ value: parsed.data, priority });
  };
  const rememberCanonical = (input: unknown, result: unknown, priority = 2) => {
    try { const retrieval = projectAppSearchRetrieval(input, result); if (retrieval) navigation.push({ value: retrieval, priority }); }
    catch { /* A navigation projection must never prevent an authorized read. */ }
  };
  const listCache = new Map<string, Promise<NamedRow[]>>();
  const listNamed = (slug: AppSearchCollectionSlug, filters?: Record<string, unknown>) => {
    const identity = JSON.stringify({ slug, filters });
    let pending = listCache.get(identity);
    if (!pending) {
      pending = search({ operation: 'list', collectionSlugs: [slug], ...(filters ? { filters } : {}), limit: 50, recordHistory: false }, context, { signal: dependencies.signal })
        .then((output) => (output as { groups: Array<{ results: NamedRow[] }> }).groups[0]?.results ?? []);
      listCache.set(identity, pending);
    }
    return pending;
  };
  const hydrate = async (slug: AppSearchCollectionSlug, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return raw;
    if (slug === 'collections') {
      const collection = raw as Record<string, unknown>;
      if (typeof collection.key !== 'string') return raw;
      const page = await search({ operation: 'list', collectionSlugs: ['images'], filters: { collectionKey: collection.key }, limit: 20, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> };
      return { ...collection, images: page.groups[0]?.results ?? [] };
    }
    if (slug !== 'trips') return raw;
    const trip = raw as Record<string, unknown>;
    const attachments = Array.isArray(trip.attachments) ? trip.attachments : [];
    if (!attachments.length) return raw;
    const linked = await Promise.allSettled(attachments.slice(0, 12).map(async (item: { type?: string; key?: string }) => {
      if (!item.key || !['folder', 'collection'].includes(item.type ?? '')) return null;
      const collectionSlug = item.type === 'folder' ? 'folders' : 'collections';
      const output = await search({ operation: 'get', collectionSlugs: [collectionSlug], key: item.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ name?: string }> }> };
      const name = output.groups[0]?.results[0]?.name;
      return name ? { type: item.type, name } : null;
    }));
    dependencies.signal?.throwIfAborted();
    return { ...trip, attachments: linked.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []) };
  };
  const record = (slug: 'collections' | 'folders' | 'inboxes' | 'trips' | 'places', key: string, label: string, destinationKey?: string) => remember(slug, key, label, destinationKey, 1);
  const resolvedParents: Array<{ resource: string; name: string } | undefined> = [];
  const results = await Promise.all(input.requests.map(async (request, index) => {
    try {
    const slug = request.resource;
    if (slug === 'workspace') {
      let hits = await find(request.query!, context, Math.min(50, Math.max(20, request.limit * 3)));
      let broadened = false;
      if (!hits.length) {
        const words = request.query!.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
        const phrases = [...new Set(words.slice(0, -1).map((word, index) => [word, words[index + 1]!]).filter((parts) => parts.every((part) => part.length >= 3)).map((parts) => parts.join(' ')))].slice(0, 4);
        const pages = await Promise.allSettled(phrases.map((phrase) => find(phrase, context, Math.max(8, request.limit))));
        dependencies.signal?.throwIfAborted();
        hits = pages.flatMap((page) => page.status === 'fulfilled' ? page.value : []);
        broadened = Boolean(hits.length);
      }
      const seen = new Set<string>();
      const uniqueHits = hits.filter(({ source, key }) => { const identity = `${sources[source] ?? source}:${key}`; if (seen.has(identity)) return false; seen.add(identity); return true; });
      const includedFamilies = new Set<string>();
      const diverse = uniqueHits.filter(({ source }) => { const family = discoveryFamilies[source]; if (includedFamilies.has(family)) return false; includedFamilies.add(family); return true; });
      const selectedHits = [...diverse, ...uniqueHits.filter((hit) => !diverse.includes(hit))].slice(0, request.limit);
      const candidates = await Promise.allSettled(selectedHits.map(async (hit) => {
        if (hit.source === 'imageCollectionMemories') {
          const memory = await graph.readMemory({ memoryKey: hit.key }, { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, membership, signal: dependencies.signal } as GalleryOperationContext);
          return { resource: 'memories', record: projectWorkspaceEvidence(memory.memory) };
        }
        if (hit.source === 'bookChapters' && hit.parentKey) {
          const book = await search({ operation: 'get', collectionSlugs: ['books'], key: hit.parentKey, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ chapters?: Array<{ key: string }> }> }> };
          const chapter = book.groups[0]?.results[0]?.chapters?.find(({ key }) => key === hit.key);
          const title = (book.groups[0]?.results[0] as { title?: string } | undefined)?.title;
          if (chapter && title) remember('books', hit.parentKey, title, undefined, 3);
          return chapter ? { resource: 'book-chapters', record: projectWorkspaceEvidence(chapter) } : null;
        }
        if ((hit.source === 'tripGuides' || hit.source === 'placeReferences') && hit.parentKey) {
          const parentSlug = hit.source === 'tripGuides' ? 'trips' : 'places';
          await search({ operation: 'get', collectionSlugs: [parentSlug], key: hit.parentKey, recordHistory: false }, context, { signal: dependencies.signal });
          const travel = dependencies.travel ?? createTravelService();
          const rows = hit.source === 'tripGuides'
            ? (await travel.listTripGuides({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, tripKey: hit.parentKey }, userKey)).guides
            : (await Promise.all((['brief', 'accommodations', 'restaurants', 'activities'] as const).map((kind) => travel.listPlaceReferences({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, placeKey: hit.parentKey!, kind }, userKey)))).flatMap(({ references }) => references);
          const row = rows.find(({ key }) => key === hit.key);
          return row ? { resource: hit.source === 'tripGuides' ? 'trip-guides' : 'place-references', record: projectWorkspaceEvidence(row) } : null;
        }
        if (hit.source === 'visualIdentities') {
          const subjects = await graph.listSubjects({}, { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, membership, signal: dependencies.signal } as GalleryOperationContext);
          const subject = subjects.subjects.find(({ key }) => key === hit.key);
          if (subject) remember('subjects', subject.key, subject.name, undefined, 3);
          return subject ? { resource: 'subjects', record: projectWorkspaceEvidence(subject) } : null;
        }
        if (hit.source === 'emailReplyContext') {
          const rows = await (dependencies.email ?? createEmailService()).listReplyContext({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey });
          const note = rows.find(({ key }) => key === hit.key);
          return note ? { resource: 'email-reply-notes', record: projectWorkspaceEvidence(note) } : null;
        }
        const collectionSlug = hit.resourceHint ?? sources[hit.source];
        if (!collectionSlug) return null;
        const operations = APP_SEARCH_COLLECTION_ADAPTERS[collectionSlug].operations as readonly string[];
        const detail = operations.includes('get')
          ? await search({ operation: 'get', collectionSlugs: [collectionSlug], key: hit.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> }
          : hit.source === 'emailDrafts'
            ? await search({ query: request.query!, collectionSlugs: ['email-drafts'], limit: 50, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> }
          : operations.includes('list') && !['email-messages', 'email-drafts'].includes(collectionSlug)
            ? await search({ operation: 'list', collectionSlugs: [collectionSlug], limit: 50, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> }
            : null;
        const record = detail?.groups[0]?.results.find((item) => item && typeof item === 'object' && ((item as { key?: unknown; thread?: { key?: unknown } }).key === hit.key || (item as { thread?: { key?: unknown } }).thread?.key === hit.key));
        if (!record) return null;
        return { resource: collectionSlug, record: projectWorkspaceEvidence(await hydrate(collectionSlug, record)) };
      }));
      dependencies.signal?.throwIfAborted();
      const matches = candidates.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []);
      for (const [index, candidate] of candidates.entries()) {
        if (candidate.status !== 'fulfilled' || !candidate.value) continue;
        const hit = selectedHits[index]!, found = candidate.value;
        if (['documents', 'files', 'folders', 'collections', 'images', 'inboxes', 'email-messages', 'email-tones', 'places', 'trips', 'books'].includes(found.resource)) {
          const slug = found.resource as AppSearchRetrievalCollectionSlug;
          if (slug === 'email-messages') {
            const inboxes = await listNamed('inboxes').catch(() => []);
            for (const inbox of inboxes.slice(0, 4)) {
              if (typeof inbox.connectorKey !== 'string') continue;
              const threads = await listNamed('email-messages', { connectorKey: inbox.connectorKey }).catch(() => []);
              if (threads.some(({ key }) => key === hit.key)) { remember('email-messages', hit.key, hit.label, inbox.connectorKey, 3); break; }
            }
          } else if (slug === 'inboxes') {
            const inbox = (await listNamed('inboxes').catch(() => [])).find(({ key }) => key === hit.key);
            if (typeof inbox?.connectorKey === 'string') remember(slug, hit.key, hit.label, inbox.connectorKey, 3);
          } else remember(slug, hit.key, hit.label, undefined, 3);
        }
      }
      return { resource: 'workspace', status: broadened || hits.length >= request.limit || matches.length < selectedHits.length || !matches.length ? 'partial' as const : 'complete' as const, matches };
    }
    if (slug === 'email-drafts' && !request.parent && ['list', 'count'].includes(request.operation)) {
      const overview = await (dependencies.email ?? createEmailService()).overview({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey }, {});
      const accounts = overview.accounts.slice(0, 10);
      const pages = await Promise.allSettled(accounts.map(({ connectorKey }) => search({ operation: 'list', collectionSlugs: ['email-drafts'], filters: { connectorKey }, limit: 50, recordHistory: false }, context, { signal: dependencies.signal })));
      dependencies.signal?.throwIfAborted();
      const connected = pages.flatMap((page) => page.status === 'fulfilled' ? (page.value as { groups: Array<{ results: unknown[] }> }).groups[0]?.results ?? [] : []);
      const rows = [...overview.unassignedDrafts, ...connected];
      const complete = overview.accounts.length <= 10 && pages.every((page) => page.status === 'fulfilled' && ((page.value as { groups: Array<{ results: unknown[] }> }).groups[0]?.results.length ?? 0) < 50);
      return request.operation === 'count' ? { resource: slug, status: complete ? 'complete' as const : 'partial' as const, ...(complete ? { count: rows.length } : {}) }
        : { resource: slug, status: complete && rows.length <= request.limit ? 'complete' as const : 'partial' as const, evidence: projectAppSearchModelResult({ operation: 'list', groups: [{ collectionSlug: slug, results: rows.slice(0, request.limit) }] }) };
    }
    let parentKey: string | undefined;
    let parentFilterKey: string | undefined;
    let inferredReadQuery: string | undefined;
    const suggestedParent = request.parent ?? (['email-messages', 'email-drafts'].includes(slug) && request.operation !== 'search' ? { resource: 'inboxes' as const }
      : slug === 'trip-guides' ? { resource: 'trips' as const } : slug === 'place-references' ? { resource: 'places' as const } : undefined);
    const directParentRead = request.operation === 'read' && suggestedParent?.resource === slug && suggestedParent.name?.replace(/^(?:collections|folders|inboxes|trips|places)\//i, '').trim();
    const expectedParent = ['documents', 'files', 'folders'].includes(slug) ? 'folders'
      : ['images', 'memories', 'highlights'].includes(slug) ? 'collections'
      : ['email-messages', 'email-drafts'].includes(slug) ? 'inboxes'
      : slug === 'trip-guides' ? 'trips' : slug === 'place-references' ? 'places' : undefined;
    if (suggestedParent && !directParentRead && (expectedParent || request.operation !== 'read') && !(slug === 'images' && input.requests.length > 1 && !suggestedParent.name && !suggestedParent.recent)) {
      const parent = suggestedParent;
      const parentResource = expectedParent ?? parent.resource;
      let parentName = parent.name?.replace(/^(?:collections|folders|inboxes|trips|places)\//i, '').trim();
      let authorized: { groups: Array<{ results: Array<{ connectorKey?: string; name?: string }> }> } | undefined;
      const refs = (dependencies.recent ?? []).flatMap((retrieval) => retrieval.groups).filter((group) => group.collectionSlug === parentResource).flatMap((group) => group.results);
      if (!parentName && question) {
        const named = namesInQuestion(await listNamed(parentResource as AppSearchCollectionSlug), question);
        if (named.length === 1) parentName = displayName(named[0]!);
      }
      if (!parentName && refs.length === 1) {
        parentKey = refs[0]!.key;
        authorized = await search({ operation: 'get', collectionSlugs: [parentResource as 'collections'], key: parentKey, recordHistory: false }, context, { signal: dependencies.signal }) as typeof authorized;
      } else if (parentName) {
        const hits = (await find(parentName, context)).filter((hit) => sources[hit.source] === parentResource && normalized(hit.label) === normalized(parentName!));
        if (!hits.length) hits.push(...(await listNamed(parentResource as AppSearchCollectionSlug)).filter((item) => normalized(displayName(item) ?? '') === normalized(parentName!)).map((item) => ({ source: parentResource === 'folders' ? 'folders' as const : parentResource === 'collections' ? 'collections' as const : parentResource === 'trips' ? 'trips' as const : parentResource === 'places' ? 'places' as const : 'emailInboxes' as const, key: item.key, label: displayName(item) ?? parentName! })));
        const verified = await Promise.allSettled(hits.map(async (hit) => ({ key: hit.key, value: await search({ operation: 'get', collectionSlugs: [parentResource as 'collections'], key: hit.key, recordHistory: false }, context, { signal: dependencies.signal }) as typeof authorized })));
        dependencies.signal?.throwIfAborted();
        const accessible = verified.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []);
        if (accessible.length !== 1) {
          const namedChild = request.operation === 'read' && slug in APP_SEARCH_COLLECTION_ADAPTERS && (APP_SEARCH_COLLECTION_ADAPTERS[slug as AppSearchCollectionSlug].operations as readonly string[]).includes('get')
            ? (await listNamed(slug as AppSearchCollectionSlug)).filter((row) => normalized(displayName(row) ?? '') === normalized(parentName!)) : [];
          if (namedChild.length === 1) inferredReadQuery = displayName(namedChild[0]!);
          else return { resource: slug, status: 'ambiguous' as const, reason: 'The named parent could not be uniquely found.' };
        }
        if (!inferredReadQuery) {
          parentKey = accessible[0]!.key;
          authorized = accessible[0]!.value;
        }
      } else {
        const candidates = await listNamed(parentResource as AppSearchCollectionSlug);
        if (candidates.length !== 1) {
          if (request.operation === 'read' && (request.query || question)) inferredReadQuery = request.query ?? undefined;
          else return { resource: slug, status: 'ambiguous' as const, reason: 'No unique authorized parent was identifiable from the request or recent conversation.' };
        }
        if (!inferredReadQuery && candidates.length === 1) {
          parentKey = candidates[0]!.key;
          authorized = await search({ operation: 'get', collectionSlugs: [parentResource as 'collections'], key: parentKey, recordHistory: false }, context, { signal: dependencies.signal }) as typeof authorized;
        }
      }
      if (!inferredReadQuery) {
        if (!authorized || !parentKey) return { resource: slug, status: 'ambiguous' as const, reason: 'The requested parent was unavailable.' };
        // The graph is discovery only; missing or revoked parents are not selectors.
        parentFilterKey = parentResource === 'inboxes' ? authorized.groups[0]?.results[0]?.connectorKey : parentKey;
        if (!parentFilterKey) throw new Error('The parent resource is unavailable.');
        const resolvedName = parentName ?? authorized.groups[0]?.results[0]?.name ?? '';
        resolvedParents[index] = { resource: parentResource, name: resolvedName };
        if (resolvedName) record(parentResource as 'collections' | 'folders' | 'inboxes' | 'trips' | 'places', parentKey, resolvedName, parentResource === 'inboxes' ? parentFilterKey : undefined);
        const children: Record<string, string[]> = { collections: ['images', 'memories', 'highlights'], folders: ['folders', 'documents', 'files'], inboxes: ['email-messages', 'email-drafts'], trips: ['trip-guides'], places: ['place-references'] };
        if (!children[parentResource]!.includes(slug)) throw new Error('This parent does not contain the requested resource.');
      }
    }
    if (slug === 'trip-guides' || slug === 'place-references') {
      if (!parentKey || !['list', 'count', 'read'].includes(request.operation)) return { resource: slug, status: 'ambiguous' as const, reason: 'An authorized trip or place is needed to read the linked resources.' };
      const travel = dependencies.travel ?? createTravelService();
      const access = { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, ...(slug === 'trip-guides' ? { tripKey: parentKey } : { placeKey: parentKey }) };
      const rows = slug === 'trip-guides'
        ? (await travel.listTripGuides(access as Parameters<typeof travel.listTripGuides>[0], userKey)).guides
        : (await Promise.all((['brief', 'accommodations', 'restaurants', 'activities'] as const).map((kind) => travel.listPlaceReferences({ ...access, kind }, userKey)))).flatMap(({ references }) => references);
      if (request.operation === 'count') return { resource: slug, status: 'complete' as const, count: rows.length };
      const parentSlug = slug === 'trip-guides' ? 'trips' : 'places';
      const parent = resolvedParents[index];
      if (parent?.name) remember(parentSlug, parentKey, parent.name, undefined, 2);
      return { resource: slug, status: rows.length > request.limit ? 'partial' as const : 'complete' as const, items: rows.slice(0, request.limit).map((row) => projectWorkspaceEvidence(row)) };
    }
    if (slug === 'email-reply-notes') {
      if (!['list', 'count'].includes(request.operation)) throw new Error('Reply context supports list and count.');
      const rows = await (dependencies.email ?? createEmailService()).listReplyContext({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey });
      return request.operation === 'count' ? { resource: slug, status: 'complete' as const, count: rows.length }
        : { resource: slug, status: rows.length > request.limit ? 'partial' as const : 'complete' as const, items: rows.slice(0, request.limit).map((row) => projectWorkspaceEvidence(row)) };
    }
    if (slug === 'subjects') {
      if (!['list', 'count'].includes(request.operation)) throw new Error('Subjects support list and count.');
      const rows = (await graph.listSubjects({}, { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, membership, signal: dependencies.signal } as GalleryOperationContext)).subjects;
      if (request.operation === 'count') return { resource: slug, status: 'complete' as const, count: rows.length };
      for (const row of rows.slice(0, request.limit)) remember('subjects', row.key, row.name, undefined, 3);
      return { resource: slug, status: rows.length > request.limit ? 'partial' as const : 'complete' as const, items: rows.slice(0, request.limit).map((row) => projectWorkspaceEvidence(row)) };
    }
    if (slug === 'memories' || slug === 'highlights') {
      if (request.operation !== 'count' && request.operation !== 'list') throw new Error('Gallery artifacts support list and count.');
      const galleryContext = { teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, membership, signal: dependencies.signal } as GalleryOperationContext;
      let inventoryComplete = true;
      let rows;
      if (slug === 'highlights') rows = (await graph.listHighlights(parentKey ? { collectionKey: parentKey } : {}, galleryContext)).highlights;
      else if (parentKey) rows = (await graph.listMemories({ collectionKey: parentKey }, galleryContext)).memories;
      else {
        const collections = await search({ operation: 'list', collectionSlugs: ['collections'], limit: 50, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: Array<{ key: string }> }> };
        const parents = collections.groups[0]?.results ?? [];
        inventoryComplete = parents.length < 50;
        const batches = await Promise.allSettled(parents.map(({ key }) => graph.listMemories({ collectionKey: key }, galleryContext)));
        inventoryComplete = inventoryComplete && batches.every((item) => item.status === 'fulfilled');
        const all = batches.flatMap((item) => item.status === 'fulfilled' ? item.value.memories : []);
        rows = [...new Map(all.map((item) => [item.key, item])).values()];
      }
      dependencies.signal?.throwIfAborted();
      if (request.operation === 'count') return { resource: slug, status: inventoryComplete ? 'complete' as const : 'partial' as const, ...(inventoryComplete ? { count: rows.length } : {}) };
      for (const item of rows.slice(0, request.limit)) {
        const destination = parentKey ?? ('collectionKey' in item && typeof item.collectionKey === 'string' ? item.collectionKey : undefined);
        if (destination) remember(slug, item.key, slug === 'memories' && 'text' in item ? item.text.slice(0, 160) : `Highlight ${item.createdAt.slice(0, 10)}`, destination, 3);
      }
      return { resource: slug, status: inventoryComplete && rows.length <= request.limit ? 'complete' as const : 'partial' as const, items: rows.slice(0, request.limit).map((item) => ({ createdAt: item.createdAt, ...(slug === 'memories' && 'text' in item ? { text: item.text } : {}), ...('images' in item ? { images: item.images.map(({ caption, filename }) => ({ caption, filename })) } : {}) })) };
    }
    const filters = parentFilterKey ? ['documents', 'files', 'folders'].includes(slug) ? { folderKey: parentFilterKey, includeDescendants: true } : ['images', 'memories', 'highlights'].includes(slug) ? { collectionKey: parentFilterKey } : { connectorKey: parentFilterKey } : undefined;
    if (request.operation === 'read') {
      const readQuery = request.query ?? inferredReadQuery ?? directParentRead;
      const operations = APP_SEARCH_COLLECTION_ADAPTERS[slug].operations as readonly string[];
      const fromList = operations.includes('list') ? await listNamed(slug, filters) : [];
      let targets = readQuery ? fromList.filter((row) => normalized(displayName(row) ?? '') === normalized(readQuery)) : question ? namesInQuestion(fromList, question) : [];
      if (!targets.length && question) {
        const best = bestNamedCandidate(fromList, question, slug === 'documents' || slug === 'files' ? 2 : 1);
        if (best) targets = [best];
      }
      if (!targets.length && readQuery && operations.includes('get')) {
        const hits = (await find(readQuery, context)).filter((hit) => (sources[hit.source] === slug || slug === 'files' && hit.source === 'documents') && normalized(hit.label) === normalized(readQuery));
        targets = hits.map(({ key, label }) => ({ key, name: label }));
      }
      if (targets.length && operations.includes('get')) {
        const selected = targets.slice(0, 4);
        const candidates = await Promise.allSettled(selected.map(async (item) => {
          const getInput = { operation: 'get' as const, collectionSlugs: [slug], key: item.key, recordHistory: false };
          const value = await search(getInput, context, { signal: dependencies.signal });
          rememberCanonical(getInput, value, 3);
          return { item, value };
        }));
        dependencies.signal?.throwIfAborted();
        const verified = candidates.flatMap((candidate) => {
          if (candidate.status !== 'fulfilled') return [];
          const record = (candidate.value.value as { groups: Array<{ results: unknown[] }> }).groups[0]?.results[0];
          return record ? [{ item: candidate.value.item, record }] : [];
        });
        if (verified.length) {
          if (verified.length === 1 && ['collections', 'inboxes', 'trips', 'places'].includes(slug)) record(slug as 'collections' | 'inboxes' | 'trips' | 'places', verified[0]!.item.key, displayName(verified[0]!.item) ?? (typeof readQuery === 'string' ? readQuery : 'Resource'), slug === 'inboxes' && typeof verified[0]!.item.connectorKey === 'string' ? verified[0]!.item.connectorKey : undefined);
          if (slug === 'email-messages' && parentFilterKey) for (const { item } of verified) remember('email-messages', item.key, displayName(item) ?? 'Email message', parentFilterKey, 3);
          const expanded = await Promise.all(verified.map(({ record }) => hydrate(slug, record)));
          if (slug === 'collections' && expanded.length === 1) {
            const collection = expanded[0] as { key?: unknown; images?: NamedRow[] };
            const selectedImage = collection.images && question ? bestNamedCandidate(collection.images, question) : undefined;
            if (selectedImage && typeof collection.key === 'string') remember('images', selectedImage.key, displayName(selectedImage) ?? 'Image', collection.key, 4);
          }
          return { resource: slug, status: selected.length < targets.length || verified.length < selected.length || expanded.some(materialTruncated) ? 'partial' as const : 'complete' as const, evidence: expanded.length === 1 ? { record: projectWorkspaceEvidence(expanded[0]) } : { records: expanded.map((item) => projectWorkspaceEvidence(item)) } };
        }
      }
      if (fromList.length && !operations.includes('get')) {
        const listInput = { operation: 'list' as const, collectionSlugs: [slug], limit: request.limit, recordHistory: false, ...(filters ? { filters } : {}) };
        rememberCanonical(listInput, { operation: 'list', groups: [{ collectionSlug: slug, results: fromList.slice(0, request.limit) }] }, 2);
        return { resource: slug, status: 'partial' as const, evidence: projectAppSearchModelResult({ operation: 'list', groups: [{ collectionSlug: slug, results: fromList.slice(0, request.limit) }] }) };
      }
      const fallbackQuery = typeof readQuery === 'string' ? readQuery : question;
      if (fallbackQuery && operations.includes('search')) {
        const searchInput = { query: fallbackQuery, collectionSlugs: [slug], ...(filters ? { filters } : {}), limit: request.limit, recordHistory: false };
        const result = await search(searchInput, context, { signal: dependencies.signal });
        rememberCanonical(searchInput, result, 2);
        return { resource: slug, status: 'partial' as const, evidence: projectAppSearchModelResult(result) };
      }
      return { resource: slug, status: 'ambiguous' as const, reason: 'No unique authorized resource was available for the detail request.' };
    }
    if (request.operation === 'search' && !request.query && !question) return { resource: slug, status: 'ambiguous' as const, reason: 'No search subject was supplied.' };
    const sumField = request.field ?? (request.operation === 'sum' ? ['images', 'documents', 'files'].includes(slug) ? 'sizeBytes' : slug === 'books' ? 'estimatedMinutes' : undefined : undefined);
    if (request.operation === 'sum' && !sumField) throw new Error('Sum requires a field.');
    const operation = request.operation;
    const searchInput = { operation, collectionSlugs: [slug], ...(operation === 'search' ? { query: request.query ?? question } : {}), ...(operation === 'sum' ? { field: sumField! } : {}), ...(filters ? { filters } : {}), limit: request.limit, recordHistory: false };
    const result = await search(searchInput, context, { signal: dependencies.signal });
    rememberCanonical(searchInput, result);
    if (question && (operation === 'search' || operation === 'list') && ['documents', 'files', 'books', 'places', 'trips', 'collections', 'email-messages'].includes(slug)) {
      const rows = (result as { groups?: Array<{ results?: NamedRow[] }> }).groups?.[0]?.results ?? [];
      const named = namesInQuestion(rows, question);
      if (named.length === 1) {
        const destination = slug === 'email-messages' ? ((named[0]!.inbox as { connectorKey?: unknown } | undefined)?.connectorKey ?? filters?.connectorKey) : undefined;
        if (slug !== 'email-messages' || typeof destination === 'string') remember(slug, named[0]!.key, displayName(named[0]!) ?? 'Resource', typeof destination === 'string' ? destination : undefined, 4);
      }
    }
    if (slug === 'images' && question && (operation === 'list' || operation === 'search')) {
      const imageRows = (result as { groups?: Array<{ results?: NamedRow[] }> }).groups?.[0]?.results ?? [];
      const image = bestNamedCandidate(imageRows, question);
      if (image) remember('images', image.key, displayName(image) ?? 'Image', typeof filters?.collectionKey === 'string' ? filters.collectionKey : undefined, 4);
    }
    const groups = (result as { groups?: Array<{ results?: unknown[] }> }).groups ?? [];
    const partial = operation === 'search' || operation === 'list' && groups.some(({ results }) => (results?.length ?? 0) >= request.limit);
    const projected = projectAppSearchModelResult(result);
    const evidence = operation === 'sum' && sumField === 'sizeBytes' && projected && typeof projected === 'object' && 'groups' in projected && Array.isArray(projected.groups)
      ? { ...projected, groups: projected.groups.map((group: { sum?: unknown }) => typeof group.sum === 'number' ? { ...group, megabytes: group.sum / 1_000_000, mebibytes: group.sum / 1_048_576 } : group) }
      : projected;
    return { resource: slug, status: partial ? 'partial' as const : 'complete' as const, evidence };
    } catch (error) {
      dependencies.signal?.throwIfAborted();
      if (error instanceof SparkRepositoryError || error instanceof SparkRefundError) throw error;
      return { resource: request.resource, status: 'unavailable' as const, reason: 'This authorized resource could not be checked.' };
    }
  }));
  const related: Array<{ resource: string; record?: unknown; items?: unknown[]; parent?: string }> = [];
  if (question && dependencies.expandRelated !== false) {
    const [tripRows, bookRows, placeRows] = await Promise.all([
      listNamed('trips').catch(() => []), listNamed('books').catch(() => []), listNamed('places').catch(() => []),
    ]);
    let trips = namesInQuestion(tripRows, question);
    if (!trips.length) {
      const [folders, collections] = await Promise.all([listNamed('folders').catch(() => []), listNamed('collections').catch(() => [])]);
      const targets = [...namesInQuestion(folders, question), ...namesInQuestion(collections, question)].map(({ key }) => key);
      if (targets.length >= 2) trips = tripRows.filter((trip) => {
        const links = Array.isArray(trip.attachments) ? trip.attachments as Array<{ key?: string }> : [];
        return targets.every((key) => links.some((link) => link.key === key));
      });
    }
    for (const [slug, matches] of [['trips', trips], ['books', namesInQuestion(bookRows, question)], ['places', namesInQuestion(placeRows, question)]] as const) {
      for (const item of matches.slice(0, 2)) {
        try {
          const value = await search({ operation: 'get', collectionSlugs: [slug], key: item.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> };
          const record = value.groups[0]?.results[0];
          if (record) {
            related.push({ resource: slug, record: projectWorkspaceEvidence(await hydrate(slug, record)) });
            remember(slug, item.key, displayName(item) ?? 'Resource', undefined, 0);
          }
          if (slug === 'trips' && record) {
            const travel = dependencies.travel ?? createTravelService();
            const guides = await travel.listTripGuides({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, tripKey: item.key }, userKey);
            if (guides.guides.length) related.push({ resource: 'trip-guides', parent: displayName(item), items: guides.guides.slice(0, 2).map((guide) => projectWorkspaceEvidence(guide)) });
          }
          if (slug === 'places' && record) {
            const travel = dependencies.travel ?? createTravelService();
            const batches = await Promise.all((['brief', 'accommodations', 'restaurants', 'activities'] as const).map((kind) => travel.listPlaceReferences({ teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, placeKey: item.key, kind }, userKey)));
            const references = batches.flatMap(({ references }) => references).slice(0, 4);
            if (references.length) related.push({ resource: 'place-references', parent: displayName(item), items: references.map((reference) => projectWorkspaceEvidence(reference)) });
          }
        } catch (error) { dependencies.signal?.throwIfAborted(); /* An inaccessible neighbor is never answer evidence. */ }
      }
    }
    const inboxes = await listNamed('inboxes').catch(() => []);
    const threadPages = await Promise.allSettled(inboxes.slice(0, 4).flatMap(({ connectorKey }) => typeof connectorKey === 'string' ? [listNamed('email-messages', { connectorKey })] : []));
    const threads = threadPages.flatMap((page) => page.status === 'fulfilled' ? page.value : []);
    const namedThread = bestNamedCandidate(threads, question);
    if (namedThread) {
      try {
        const value = await search({ operation: 'get', collectionSlugs: ['email-messages'], key: namedThread.key, recordHistory: false }, context, { signal: dependencies.signal }) as { groups: Array<{ results: unknown[] }> };
        const thread = value.groups[0]?.results[0];
        if (thread) {
          related.push({ resource: 'email-messages', record: projectWorkspaceEvidence(thread) });
          for (const inbox of inboxes.slice(0, 4)) {
            if (typeof inbox.connectorKey !== 'string') continue;
            if ((await listNamed('email-messages', { connectorKey: inbox.connectorKey })).some(({ key }) => key === namedThread.key)) {
              remember('email-messages', namedThread.key, displayName(namedThread) ?? 'Email message', inbox.connectorKey, 0);
              break;
            }
          }
        }
      } catch (error) { dependencies.signal?.throwIfAborted(); /* Ignore inaccessible relationships. */ }
    }
    const queries = [...new Set(input.requests.flatMap((request) => (request.operation === 'search' || request.operation === 'discover') && request.query ? [request.query] : []))].slice(0, 2);
    for (const query of queries) {
      const discovered = await queryWorkspace({ requests: [{ operation: 'discover', resource: 'workspace', query, limit: 8 }] }, context, { ...dependencies, message: undefined, expandRelated: false, onEvidence: undefined }).catch(() => null);
      const matches = discovered?.results[0];
      if (matches && 'matches' in matches && Array.isArray(matches.matches)) for (const match of matches.matches.slice(0, 4)) related.push({ resource: match.resource, record: match.record });
    }
  }
  if (navigation.length && dependencies.onEvidence) {
    const seen = new Set<string>();
    const selected: AppSearchRetrieval[] = [];
    for (const { value } of navigation.sort((left, right) => right.priority - left.priority)) {
      const groups = value.groups.flatMap((group) => {
        const results = group.results.filter((item) => {
          if (['tags', 'tag-assignments', 'tickets', 'notifications'].includes(group.collectionSlug)) return false;
          if (['inboxes', 'email-messages', 'email-drafts', 'memories', 'highlights'].includes(group.collectionSlug) && !item.destinationKey && !value.filters?.connectorKey) return false;
          const identity = `${group.collectionSlug}:${item.key}`;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
        return results.length ? [{ ...group, results }] : [];
      });
      if (!groups.length) continue;
      selected.push(appSearchRetrievalSchema.parse({ ...value, groups }));
      if (selected.length >= 4) break;
    }
    if (selected.length) dependencies.onEvidence(selected);
  }
  return { results: results.map((result, index) => ({ ...result, ...(resolvedParents[index] ? { within: resolvedParents[index] } : {}) })), ...(related.length ? { related: related.slice(0, 8) } : {}) };
}
