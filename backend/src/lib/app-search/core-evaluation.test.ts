import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import type { CoreChatInput } from '@/lib/ai/actions';
import type { ProviderStreamChunk } from '@/lib/ai/providers';
import { TOOL_DEFINITIONS } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { ConversationRepository } from '@/lib/conversations/repository';
import type { ConversationMessage } from '@/lib/conversations/schemas';
import { createConversationService, type ConversationTurnEvent } from '@/lib/conversations/service';
import { createAppSearchService, type AppSearchInput, type AppSearchResult, type AppSearchRetrieval } from './service';

const id = (value: number) => `c${String(value).padStart(24, '0')}`;
const at = '2026-09-03T10:00:00.000Z';
const oldAt = '2026-05-10T08:00:00.000Z';
const organizationKey = id(1), scopeKey = id(2), userKey = id(3), membershipKey = id(4), conversationKey = id(5);
const workTag = { key: id(130), scopeKey, userKey, name: 'Work', normalizedName: 'work', description: 'Professional projects', embedding: Array(EMBEDDING_DIMENSIONS).fill(0.01), createdAt: oldAt, updatedAt: at };
const priorityTag = { key: id(131), scopeKey, userKey, name: 'Priority', normalizedName: 'priority', description: 'Important items', embedding: Array(EMBEDDING_DIMENSIONS).fill(0.02), createdAt: at, updatedAt: at };
const context = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, userId: userKey, status: 'active' } },
} as unknown as ToolContext;
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.01);

const folders = [
  { key: id(10), scopeKey, name: 'Project Atlas', description: 'Research and launch planning', isFavorite: true, createdAt: oldAt, updatedAt: at },
  { key: id(11), scopeKey, name: 'Receipts', description: 'Household receipts', isFavorite: false, createdAt: at, updatedAt: at },
];
const documents = [
  { key: id(20), scopeKey, name: 'Research Note', folderKey: folders[0]!.key, folder: { key: folders[0]!.key, name: folders[0]!.name }, isFavorite: true, content: 'The cobalt findings show that retention improved by 18 percent.', createdAt: oldAt, updatedAt: at },
  { key: id(21), scopeKey, name: 'Meeting Notes', folderKey: folders[0]!.key, folder: { key: folders[0]!.key, name: folders[0]!.name }, mimeType: 'text/plain', sizeBytes: 1_200, isFavorite: false, content: 'The launch review is scheduled for Thursday.', createdAt: at, updatedAt: at },
  { key: id(22), scopeKey, name: 'Q4 Budget.pdf', folderKey: folders[0]!.key, folder: { key: folders[0]!.key, name: folders[0]!.name }, extension: 'pdf', mimeType: 'application/pdf', sizeBytes: 2_500, isFavorite: false, content: 'The approved Q4 budget is 42000 EUR.', createdAt: at, updatedAt: at },
  { key: id(23), scopeKey, name: 'Travel Tickets.pdf', folderKey: folders[1]!.key, folder: { key: folders[1]!.key, name: folders[1]!.name }, extension: 'pdf', mimeType: 'application/pdf', sizeBytes: 500, isFavorite: false, content: 'Rail tickets for Stockholm.', createdAt: at, updatedAt: at },
];
const galleryCollections = [
  { key: id(30), name: 'Coastal Days', description: 'Sea and lighthouse photos', purpose: null, mutationPolicy: 'user', presentation: 'travel', isFavorite: true, count: 2, coverUrl: null, memberKey: membershipKey, isOwned: true, role: 'owner', access: { canRead: true, canContribute: true, canManage: true }, createdAt: oldAt, updatedAt: at },
  { key: id(31), name: 'Family', description: 'Family photos', purpose: null, mutationPolicy: 'user', isFavorite: false, count: 1, coverUrl: null, memberKey: membershipKey, isOwned: true, role: 'owner', access: { canRead: true, canContribute: true, canManage: true }, createdAt: at, updatedAt: at },
] as const;
const image = (key: string, filename: string, caption: string, sizeBytes: number, collections: Array<{ key: string; name: string }>) => ({
  key, filename, caption, imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes, width: 1_600, height: 900,
  city: 'Gothenburg', country: 'Sweden', countryCode: 'SE', latitude: 57.7089, longitude: 11.9746, locationSource: 'supplied' as const,
  origin: 'uploaded' as const, mutationPolicy: 'user' as const, isFavorite: false, createdAt: at, updatedAt: at,
  url: `https://example.test/${filename}`, score: 0.9, collections,
});
const images = [
  image(id(40), 'lighthouse.jpg', 'Orange lighthouse at sunset', 3_000_000, [{ key: galleryCollections[0].key, name: galleryCollections[0].name }]),
  image(id(41), 'cat.jpg', 'Maine coon on a blue chair', 2_000_000, []),
  image(id(42), 'family.jpg', 'Family picnic', 1_000_000, [{ key: galleryCollections[1].key, name: galleryCollections[1].name }]),
];
const inboxes = [
  { key: id(50), connectorKey: id(51), provider: 'gmail', email: 'work@example.test', name: 'Work', description: 'Company mail', isFavorite: true, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', lastSyncedAt: at, createdAt: oldAt, updatedAt: at, score: 0.9 },
  { key: id(52), connectorKey: id(53), provider: 'gmail', email: 'personal@example.test', name: 'Personal', description: 'Personal mail', isFavorite: false, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', lastSyncedAt: at, createdAt: at, updatedAt: at, score: 0.8 },
] as const;
const tones = [
  { key: id(60), slug: 'warm', name: 'Warm', instruction: 'Be considerate and encouraging.', isFavorite: true, createdAt: oldAt, updatedAt: at, score: 0.9 },
  { key: id(61), slug: 'direct', name: 'Direct', instruction: 'State the request plainly.', isFavorite: false, createdAt: at, updatedAt: at, score: 0.8 },
] as const;
const messages = [
  { key: id(70), connectorKey: inboxes[0].connectorKey, subject: 'Launch code', summary: 'Production launch credentials', intent: 'Review the launch code', priority: 'urgent', state: 'needs_action', lastMessageAt: at, unread: true, isRead: false, isFavorite: true, inboxCategory: 'Urgent', createdAt: oldAt, updatedAt: at, score: 0.95 },
  { key: id(71), connectorKey: inboxes[0].connectorKey, subject: 'Quarterly review', summary: 'Review agenda', intent: 'Attend review', priority: 'normal', state: 'informational', lastMessageAt: at, unread: true, isRead: false, isFavorite: false, inboxCategory: 'Important', createdAt: at, updatedAt: at, score: 0.8 },
  { key: id(72), connectorKey: inboxes[0].connectorKey, subject: 'Old receipt', summary: 'Receipt archive', intent: 'Archive', priority: 'low', state: 'done', lastMessageAt: oldAt, unread: false, isRead: true, isFavorite: false, inboxCategory: 'Filtered', createdAt: oldAt, updatedAt: oldAt, score: 0.7 },
] as const;
const drafts = [
  { key: id(80), variant: 'new', connectorKey: inboxes[0].connectorKey, to: ['team@example.test'], subject: 'Lisbon itinerary', instruction: 'Share the itinerary', generatedContent: 'Here is the Lisbon itinerary.', status: 'generated', createdAt: oldAt, updatedAt: at, score: 0.9 },
  { key: id(81), variant: 'new', connectorKey: inboxes[0].connectorKey, to: ['finance@example.test'], subject: 'Budget follow-up', generatedContent: 'Following up on the budget.', status: 'edited', finalContent: 'Please review the attached budget.', createdAt: at, updatedAt: at, score: 0.8 },
] as const;
const stockholm = { key: id(90), kind: 'place', name: 'Stockholm', summary: 'Swedish capital by the archipelago', countryCode: 'SE', latitude: 59.3293, longitude: 18.0686, status: 'visited', isFavorite: true, createdAt: oldAt } as const;
const kyoto = { key: id(91), kind: 'place', name: 'Kyoto', summary: 'Historic temples and gardens', countryCode: 'JP', latitude: 35.0116, longitude: 135.7681, status: 'wishlist', isFavorite: false, createdAt: at } as const;
const trips = [
  { key: id(100), name: 'Nordic Summer', description: 'A completed Scandinavian rail trip', status: 'completed', isFavorite: true, createdAt: oldAt, updatedAt: at, places: [stockholm], attachments: [] },
  { key: id(101), name: 'Japan Autumn', description: 'A planned trip to Japan', status: 'planned', isFavorite: false, createdAt: at, updatedAt: at, places: [kyoto], attachments: [] },
] as const;
const places = [{ ...stockholm, trips: [{ key: trips[0].key, name: trips[0].name }] }, kyoto];
const books = [
  { key: id(110), title: 'Systems Thinking', subtitle: 'Feedback Loops', description: 'A practical guide to systems and causal feedback loops.', status: 'ready', isFavorite: true, isExtending: false, estimatedMinutes: 45, chapterCount: 6, progressPercent: 50, createdAt: oldAt, updatedAt: at, score: 0.95 },
  { key: id(111), title: 'Deep Focus', subtitle: 'Attention at Work', description: 'Methods for sustained attention.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 4, progressPercent: 0, createdAt: at, updatedAt: at, score: 0.8 },
  { key: id(112), title: 'Draft Book', subtitle: 'Incomplete', description: 'An unsuccessful generation.', status: 'failed', isFavorite: false, isExtending: false, estimatedMinutes: 0, chapterCount: 0, progressPercent: 0, generationProgressPercent: 20, failureMessage: 'Generation failed.', createdAt: at, updatedAt: at, score: 0.1 },
] as const;
const tagAssignmentRows = [
  { key: id(140), tag: workTag, target: { type: 'document' as const, key: documents[2]!.key, label: documents[2]!.name } },
  { key: id(141), tag: workTag, target: { type: 'book' as const, key: books[0]!.key, label: books[0]!.title } },
  { key: id(142), tag: priorityTag, target: { type: 'book' as const, key: books[0]!.key, label: books[0]!.title } },
  { key: id(143), tag: workTag, target: { type: 'book' as const, key: books[1]!.key, label: books[1]!.title } },
  { key: id(144), tag: priorityTag, target: { type: 'image' as const, key: images[0]!.key, label: images[0]!.caption } },
  { key: id(145), tag: priorityTag, target: { type: 'image' as const, key: images[2]!.key, label: images[2]!.caption } },
] as const;

function contains(value: unknown, query: string) {
  return JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function inDateRange<T extends { createdAt?: string }>(items: readonly T[], input: { createdFrom?: string; createdTo?: string }) {
  return items.filter(({ createdAt }) => (!input.createdFrom || Boolean(createdAt && createdAt >= input.createdFrom)) && (!input.createdTo || Boolean(createdAt && createdAt <= input.createdTo)));
}

function createSeededAppSearchService() {
  const assignments = new Map<string, typeof workTag[]>();
  for (const row of tagAssignmentRows) assignments.set(`${row.target.type}:${row.target.key}`, [...(assignments.get(`${row.target.type}:${row.target.key}`) ?? []), row.tag]);
  const scopeTags = {
    list: async () => [workTag, priorityTag],
    get: async (_owner: unknown, key: string) => [workTag, priorityTag].find((tag) => tag.key === key) ?? null,
    resolveOwnedByNormalizedNames: async (_owner: unknown, names: string[]) => [workTag, priorityTag].filter((tag) => names.includes(tag.normalizedName)),
    searchOwned: async (_owner: unknown, _embedding: number[], limit: number) => [workTag, priorityTag].slice(0, limit).map((tag, index) => ({ ...tag, score: 1 - index / 100 })),
    resolveCandidateKeys: async (_owner: unknown, tagKeys: string[], targetTypes: string[], match: 'any' | 'all') => Object.fromEntries(targetTypes.map((type) => [type, [...assignments].filter(([identity, tags]) => identity.startsWith(`${type}:`) && (match === 'all' ? tagKeys.every((key) => tags.some((tag) => tag.key === key)) : tagKeys.some((key) => tags.some((tag) => tag.key === key)))).map(([identity]) => identity.slice(type.length + 1))])),
    resolveEmailThreadKeys: async () => [],
    rankCandidateKeys: async (_owner: unknown, _targetType: string, candidateKeys: string[]) => candidateKeys.map((key, index) => ({ key, score: 1 - index / 100 })),
    listTargetTags: async (_owner: unknown, targets: Array<{ type: string; key: string }>) => Object.fromEntries(targets.map((target) => [`${target.type}\0${target.key}`, (assignments.get(`${target.type}:${target.key}`) ?? []).map(({ key, name }) => ({ key, name }))])),
    listAssignments: async (_owner: unknown, query: { tagKeys?: string[]; tagMatch: 'any' | 'all'; targetTypes?: string[]; limit?: number }) => tagAssignmentRows.filter((row) => (!query.targetTypes || query.targetTypes.includes(row.target.type)) && (!query.tagKeys || query.tagKeys.includes(row.tag.key)) && (query.tagMatch !== 'all' || query.tagKeys!.every((key) => (assignments.get(`${row.target.type}:${row.target.key}`) ?? []).some((tag) => tag.key === key)))).slice(0, query.limit).map((row) => ({ key: row.key, tag: { key: row.tag.key, name: row.tag.name }, target: row.target })),
    countAssignments: async (_owner: unknown, query: { tagKeys?: string[]; tagMatch: 'any' | 'all'; targetTypes?: string[] }) => tagAssignmentRows.filter((row) => (!query.targetTypes || query.targetTypes.includes(row.target.type)) && (!query.tagKeys || query.tagKeys.includes(row.tag.key)) && (query.tagMatch !== 'all' || query.tagKeys!.every((key) => (assignments.get(`${row.target.type}:${row.target.key}`) ?? []).some((tag) => tag.key === key)))).length,
    getAssignment: async (_owner: unknown, key: string) => { const row = tagAssignmentRows.find((item) => item.key === key); return row ? { key: row.key, tag: { key: row.tag.key, name: row.tag.name }, target: row.target } : null; },
  } as never;
  const executeContent = async (tool: string, raw: any) => {
    if (tool === 'content.search') return {
      query: raw.query,
      folders: inDateRange(folders, raw).filter((item) => contains(item, raw.query)).map((item) => ({ ...item, score: 0.9 })),
      documents: inDateRange(documents, raw).filter((item) => contains(item, raw.query)).map(({ key, ...item }) => ({ documentKey: key, ...item, score: 0.9 })),
    };
    if (tool === 'folder.list') return { folders: inDateRange(folders, raw).filter((item) => !raw.parentFolderKey || ('parentFolderKey' in item && item.parentFolderKey === raw.parentFolderKey)) };
    if (tool === 'folder.find') return { results: folders.filter(({ key }) => raw.folderKeys.includes(key)).map((folder) => ({ success: true, data: { folder } })) };
    if (tool === 'document.list') return { documents: inDateRange(documents, raw).filter((item) => !raw.folderKey || item.folderKey === raw.folderKey) };
    if (tool === 'document.find') return { results: documents.filter(({ key }) => raw.documentKeys.includes(key)).map((document) => ({ success: true, data: { document, content: document.content } })) };
    if (tool === 'document.summarize') {
      const document = documents.find(({ key }) => raw.documentKeys.includes(key));
      return { results: document ? [{ success: true, data: { documentKey: document.key, text: `Summary: ${document.content}` } }] : [] };
    }
    throw new Error(`Unexpected content tool ${tool}`);
  };
  const overviewCounts = { all: messages.length, important: 1, urgent: 1, needsAction: 1, filtered: 1, unread: 2, favorite: 1, trash: 0 };
  return createAppSearchService({
    scopeTags,
    executeEmbedding: async () => ({ embedding }),
    executeContent: executeContent as never,
    galleryOverview: (async (raw: any) => ({
      collections: inDateRange(galleryCollections, raw).filter((item) => !raw.collectionKey || item.key === raw.collectionKey),
      images: inDateRange(images, raw).filter((item) => !raw.collectionKey || item.collections.some(({ key }) => key === raw.collectionKey)),
    })) as never,
    gallerySearch: (async (raw: any) => ({ images: inDateRange(images, raw).filter((item) => (!raw.collectionKey || item.collections.some(({ key }) => key === raw.collectionKey)) && contains(item, raw.query)) })) as never,
    galleryCollectionSearch: (async (raw: any) => ({ collections: inDateRange(galleryCollections, raw).filter((item) => contains(item, raw.query)).map((item) => ({ ...item, score: 0.9 })) })) as never,
    email: {
      overview: async (_actor: unknown, raw: any = {}) => {
        const connectorMessages = messages.filter((item) => !raw.connectorKey || item.connectorKey === raw.connectorKey);
        const selected = inDateRange(connectorMessages, raw).filter((item) => (!raw.readState || (raw.readState === 'unread' ? item.unread : !item.unread)) && (!raw.facets?.length || raw.facets.every((facet: string) => facet === 'urgent' ? item.inboxCategory === 'Urgent' : facet === 'important' ? item.inboxCategory === 'Important' : facet === 'filtered' ? item.inboxCategory === 'Filtered' : item.isFavorite)));
        return { accounts: inboxes, tones, threads: selected, drafts, counts: overviewCounts, nextCursor: null };
      },
      searchInboxes: async (_actor: unknown, raw: any) => ({ inboxes: inDateRange(inboxes, raw).filter((item) => contains(item, raw.query)) }),
      searchTones: async (_actor: unknown, raw: any) => ({ tones: inDateRange(tones, raw).filter((item) => contains(item, raw.query)) }),
      searchMessages: async (_actor: unknown, raw: any) => ({ threads: inDateRange(messages, raw).filter((item) => item.connectorKey === raw.connectorKey && contains(item, raw.query)).map(({ connectorKey: _connectorKey, ...item }) => item) }),
      searchDrafts: async (_actor: unknown, raw: any) => ({ drafts: inDateRange(drafts, raw).filter((item) => item.connectorKey === raw.connectorKey && contains(item, raw.query)) }),
      listDrafts: async (_actor: unknown, raw: any) => { const selected = inDateRange(drafts, raw).filter((item) => item.connectorKey === raw.connectorKey); return { drafts: selected.slice(0, raw.limit), total: selected.length, offset: raw.offset ?? 0, limit: raw.limit }; },
      threadForTool: async (_actor: unknown, threadKey: string) => {
        const thread = messages.find(({ key }) => key === threadKey);
        return thread ? { thread, messages: [{ from: 'lead@example.test', sentAt: at, subject: thread.subject, body: thread.key === messages[0].key ? 'The launch code is cobalt-7.' : thread.summary }], truncated: false } : undefined;
      },
    } as never,
    travel: {
      overview: async () => ({ places }),
      listTrips: async () => ({ trips }),
      searchPlaces: async (raw: any) => ({ places: inDateRange(places, raw).filter((item) => contains(item, raw.query)) }),
      searchTrips: async (raw: any) => ({ trips: inDateRange(trips, raw).filter((item) => contains(item, raw.query)) }),
    } as never,
    countries: { search: async (raw: any) => ({ country: contains({ name: 'Japan', countryCode: 'JP' }, raw.query) ? { name: 'Japan', countryCode: 'JP', latitude: 36.2048, longitude: 138.2529 } : null }) } as never,
    books: {
      overview: async () => ({ books }),
      search: async (raw: any) => ({ books: inDateRange(books, raw).filter((item) => contains(item, raw.query)) }),
      detail: async (key: string) => {
        const book = books.find((item) => item.key === key);
        if (!book) throw new Error('Book not found');
        return { book, chapters: Array.from({ length: book.chapterCount }, (_, index) => ({ key: id(120 + index), title: `Chapter ${index + 1}`, description: 'Systems lesson', content: index === 0 ? 'Causal feedback loops can amplify or balance change.' : 'Additional systems material.', position: index + 1, estimatedMinutes: 5 })) };
      },
    } as never,
    userSearches: { record: async () => ({}) } as never,
  });
}

type Locale = 'en' | 'sv' | 'es' | 'ja';
const locales: Array<{ locale: Locale; marker: string }> = [
  { locale: 'en', marker: 'Workspace result' },
  { locale: 'sv', marker: 'Resultat i arbetsytan' },
  { locale: 'es', marker: 'Resultado del espacio de trabajo' },
  { locale: 'ja', marker: 'ワークスペースの結果' },
];
type Prompts = Record<Locale, string>;
const prompts = (en: string, sv: string, es: string, ja: string): Prompts => ({ en, sv, es, ja });
type Signature = Record<string, unknown>;
type Scenario = { id: string; prompts: Prompts; input?: AppSearchInput; facts: string[]; expected?: Signature; retrievals?: AppSearchRetrieval[]; answers?: Prompts; forbiddenAnswerFragments?: string[] };

function searchScenario(input: {
  id: string;
  prompts: Prompts;
  query: string;
  collectionSlug: AppSearchInput['collectionSlugs'][number];
  limit: number;
  keys: string[];
  facts: string[];
  answers?: Prompts;
  forbiddenAnswerFragments?: string[];
}): Scenario {
  return {
    id: input.id,
    prompts: input.prompts,
    input: { query: input.query, collectionSlugs: [input.collectionSlug], recordHistory: true, limit: input.limit },
    facts: input.facts,
    expected: { query: input.query, groups: [{ collectionSlug: input.collectionSlug, keys: input.keys }] },
    answers: input.answers,
    forbiddenAnswerFragments: input.forbiddenAnswerFragments,
  };
}

function resultSignature(result: AppSearchResult): Signature {
  if ('query' in result) return { query: result.query, groups: result.groups.map(({ collectionSlug, results }) => ({ collectionSlug, keys: results.map((item) => collectionSlug === 'countries' ? (item as { countryCode: string }).countryCode : (item as { key: string }).key) })) };
  if (result.operation === 'count') return result;
  if (result.operation === 'sum') return result;
  if (result.operation === 'summarize') return result;
  return { operation: result.operation, groups: result.groups.map(({ collectionSlug, results, totalCount }) => ({ collectionSlug, keys: results.map((item: any) => item.key), ...(totalCount === undefined ? {} : { totalCount }) })) };
}

const scenarios: Scenario[] = [
  { id: 'general-capital', prompts: prompts('What is the capital of France?', 'Vad är Frankrikes huvudstad?', '¿Cuál es la capital de Francia?', 'フランスの首都はどこですか？'), facts: ['Paris'], answers: prompts('Paris is the capital of France.', 'Paris är Frankrikes huvudstad.', 'París es la capital de Francia.', 'フランスの首都はパリ（Paris）です。') },
  { id: 'general-arithmetic', prompts: prompts('What is 17 plus 25?', 'Vad är 17 plus 25?', '¿Cuánto es 17 más 25?', '17足す25はいくつですか？'), facts: ['42'], answers: prompts('17 plus 25 is 42.', '17 plus 25 är 42.', '17 más 25 es 42.', '17足す25は42です。') },
  { id: 'general-writing', prompts: prompts('Give me a short synonym for quick.', 'Ge mig en kort synonym till snabb.', 'Dame un sinónimo corto de rápido.', '「速い」の短い類義語を教えてください。'), facts: ['fast'], answers: prompts('A short synonym is fast.', 'En kort engelsk synonym är fast.', 'Un sinónimo corto en inglés es fast.', '短い英語の類義語は fast です。') },
  { id: 'general-date', prompts: prompts('What year is in the current date?', 'Vilket år är det i dagens datum?', '¿Qué año aparece en la fecha actual?', '現在の日付は何年ですか？'), facts: ['2026'], answers: prompts('The current year is 2026.', 'Det nuvarande året är 2026.', 'El año actual es 2026.', '現在の年は2026年です。') },

  { id: 'search-folder', prompts: prompts('Find my Project Atlas folder.', 'Hitta mappen Project Atlas.', 'Busca mi carpeta Project Atlas.', 'Project Atlas フォルダーを探して。'), input: { query: 'Project Atlas', collectionSlugs: ['folders'], recordHistory: true, limit: 10 }, facts: ['Project Atlas'], expected: { query: 'Project Atlas', groups: [{ collectionSlug: 'folders', keys: [folders[0].key] }] }, retrievals: [{ query: 'Project Atlas', limit: 10, searchCollectionSlugs: ['folders'], groups: [{ collectionSlug: 'folders', results: [{ key: folders[0].key, label: 'Project Atlas' }] }] }] },
  { id: 'search-document', prompts: prompts('Which document mentions the cobalt findings?', 'Vilket dokument nämner cobalt-resultaten?', '¿Qué documento menciona los hallazgos cobalt?', 'cobalt の調査結果がある文書はどれ？'), input: { query: 'cobalt findings', collectionSlugs: ['documents'], recordHistory: true, limit: 10 }, facts: ['Research Note', '18'], expected: { query: 'cobalt findings', groups: [{ collectionSlug: 'documents', keys: [documents[0].key] }] }, retrievals: [{ query: 'cobalt findings', limit: 10, searchCollectionSlugs: ['documents'], groups: [{ collectionSlug: 'folders', results: [{ key: folders[0].key, label: 'Project Atlas', destinationCollectionSlug: 'documents' }] }] }] },
  { id: 'search-file', prompts: prompts('Find the Q4 budget file.', 'Hitta Q4-budgetfilen.', 'Busca el archivo del presupuesto Q4.', 'Q4予算ファイルを探して。'), input: { query: 'Q4 Budget', collectionSlugs: ['files'], recordHistory: true, limit: 10 }, facts: ['Q4 Budget.pdf', '42000'], expected: { query: 'Q4 Budget', groups: [{ collectionSlug: 'files', keys: [documents[2].key] }] }, retrievals: [{ query: 'Q4 Budget', limit: 10, searchCollectionSlugs: ['files'], groups: [{ collectionSlug: 'folders', results: [{ key: folders[0].key, label: 'Project Atlas', destinationCollectionSlug: 'files' }] }] }] },
  { id: 'search-collection', prompts: prompts('Show the Coastal Days collection.', 'Visa samlingen Coastal Days.', 'Muestra la colección Coastal Days.', 'Coastal Days コレクションを表示して。'), input: { query: 'Coastal Days', collectionSlugs: ['collections'], recordHistory: true, limit: 10 }, facts: ['Coastal Days'], expected: { query: 'Coastal Days', groups: [{ collectionSlug: 'collections', keys: [galleryCollections[0].key] }] }, retrievals: [{ query: 'Coastal Days', limit: 10, searchCollectionSlugs: ['collections'], groups: [{ collectionSlug: 'collections', results: [{ key: galleryCollections[0].key, label: 'Coastal Days' }] }] }] },
  { id: 'search-image', prompts: prompts('Where is my orange lighthouse picture?', 'Var är min orange fyrbild?', '¿Dónde está mi foto del faro naranja?', 'オレンジ色の灯台の写真はどこ？'), input: { query: 'orange lighthouse', collectionSlugs: ['images'], recordHistory: true, limit: 10 }, facts: ['Orange lighthouse', 'Coastal Days'], expected: { query: 'orange lighthouse', groups: [{ collectionSlug: 'images', keys: [images[0].key] }] }, retrievals: [{ query: 'orange lighthouse', limit: 10, searchCollectionSlugs: ['images'], groups: [{ collectionSlug: 'collections', results: [{ key: galleryCollections[0].key, label: 'Coastal Days' }] }] }] },
  { id: 'search-inbox', prompts: prompts('Find my Work mailbox.', 'Hitta min Work-brevlåda.', 'Busca mi buzón Work.', 'Work メールボックスを探して。'), input: { query: 'Work', collectionSlugs: ['inboxes'], recordHistory: true, limit: 10 }, facts: ['Work', 'work@example.test'], expected: { query: 'Work', groups: [{ collectionSlug: 'inboxes', keys: [inboxes[0].key] }] }, retrievals: [{ query: 'Work', limit: 10, searchCollectionSlugs: ['inboxes'], groups: [{ collectionSlug: 'inboxes', results: [{ key: inboxes[0].key, destinationKey: inboxes[0].connectorKey, label: 'Work' }] }] }] },
  { id: 'search-tone', prompts: prompts('Find my encouraging email tone.', 'Hitta min uppmuntrande e-postton.', 'Busca mi tono de correo alentador.', '励ます感じのメールトーンを探して。'), input: { query: 'encouraging', collectionSlugs: ['email-tones'], recordHistory: true, limit: 10 }, facts: ['Warm', 'encouraging'], expected: { query: 'encouraging', groups: [{ collectionSlug: 'email-tones', keys: [tones[0].key] }] }, retrievals: [{ query: 'encouraging', limit: 10, searchCollectionSlugs: ['email-tones'], groups: [{ collectionSlug: 'email-tones', results: [{ key: tones[0].key, label: 'Warm' }] }] }] },
  { id: 'search-message', prompts: prompts('What was the launch code in my email?', 'Vilken var launch-koden i mitt mejl?', '¿Cuál era el código de lanzamiento en mi correo?', 'メールにあったローンチコードは何？'), input: { query: 'launch code', collectionSlugs: ['email-messages'], recordHistory: true, limit: 10 }, facts: ['cobalt-7'], expected: { query: 'launch code', groups: [{ collectionSlug: 'email-messages', keys: [messages[0].key] }] }, retrievals: [{ query: 'launch code', limit: 10, searchCollectionSlugs: ['email-messages'], groups: [{ collectionSlug: 'inboxes', results: [{ key: inboxes[0].key, destinationKey: inboxes[0].connectorKey, destinationCollectionSlug: 'email-messages', label: 'Work' }] }] }] },
  { id: 'search-draft', prompts: prompts('Find my Lisbon itinerary draft.', 'Hitta mitt utkast om Lisbon-resplanen.', 'Busca mi borrador del itinerario de Lisbon.', 'Lisbon の旅程の下書きを探して。'), input: { query: 'Lisbon itinerary', collectionSlugs: ['email-drafts'], recordHistory: true, limit: 10 }, facts: ['Lisbon itinerary'], expected: { query: 'Lisbon itinerary', groups: [{ collectionSlug: 'email-drafts', keys: [drafts[0].key] }] }, retrievals: [{ query: 'Lisbon itinerary', limit: 10, searchCollectionSlugs: ['email-drafts'], groups: [{ collectionSlug: 'inboxes', results: [{ key: inboxes[0].key, destinationKey: inboxes[0].connectorKey, destinationCollectionSlug: 'email-drafts', label: 'Work' }] }] }] },
  { id: 'search-place', prompts: prompts('Find my saved place Stockholm.', 'Hitta min sparade plats Stockholm.', 'Busca mi lugar guardado Stockholm.', '保存した場所 Stockholm を探して。'), input: { query: 'Stockholm', collectionSlugs: ['places'], recordHistory: true, limit: 10 }, facts: ['Stockholm', 'Nordic Summer'], expected: { query: 'Stockholm', groups: [{ collectionSlug: 'places', keys: [stockholm.key] }] }, retrievals: [{ query: 'Stockholm', limit: 10, searchCollectionSlugs: ['places'], groups: [{ collectionSlug: 'trips', results: [{ key: trips[0].key, label: 'Nordic Summer' }] }] }] },
  { id: 'search-trip', prompts: prompts('Find my Scandinavian rail trip.', 'Hitta min skandinaviska tågresa.', 'Busca mi viaje ferroviario escandinavo.', 'スカンジナビア鉄道旅行を探して。'), input: { query: 'Scandinavian rail', collectionSlugs: ['trips'], recordHistory: true, limit: 10 }, facts: ['Nordic Summer'], expected: { query: 'Scandinavian rail', groups: [{ collectionSlug: 'trips', keys: [trips[0].key] }] }, retrievals: [{ query: 'Scandinavian rail', limit: 10, searchCollectionSlugs: ['trips'], groups: [{ collectionSlug: 'trips', results: [{ key: trips[0].key, label: 'Nordic Summer' }] }] }] },
  { id: 'search-country', prompts: prompts('Where is Japan?', 'Var ligger Japan?', '¿Dónde está Japón?', '日本はどこにありますか？'), input: { query: 'Japan', collectionSlugs: ['countries'], recordHistory: true, limit: 10 }, facts: ['Japan', 'JP'], expected: { query: 'Japan', groups: [{ collectionSlug: 'countries', keys: ['JP'] }] }, retrievals: [{ query: 'Japan', limit: 10, searchCollectionSlugs: ['countries'], groups: [{ collectionSlug: 'countries', results: [{ key: 'JP', label: 'Japan' }] }] }] },
  { id: 'search-book', prompts: prompts('Which audio book covers causal feedback loops?', 'Vilken ljudbok handlar om kausala feedback-loopar?', '¿Qué audiolibro trata los bucles de retroalimentación causal?', '因果フィードバックループを扱うオーディオブックはどれ？'), input: { query: 'causal feedback loops', collectionSlugs: ['books'], recordHistory: true, limit: 10 }, facts: ['Systems Thinking', 'feedback loops'], expected: { query: 'causal feedback loops', groups: [{ collectionSlug: 'books', keys: [books[0].key] }] }, retrievals: [{ query: 'causal feedback loops', limit: 10, searchCollectionSlugs: ['books'], groups: [{ collectionSlug: 'books', results: [{ key: books[0].key, label: 'Systems Thinking' }] }] }] },

  { id: 'count-folders', prompts: prompts('How many folders do I have?', 'Hur många mappar har jag?', '¿Cuántas carpetas tengo?', 'フォルダーはいくつありますか？'), input: { operation: 'count', collectionSlugs: ['folders'], recordHistory: true, limit: 10 }, facts: ['2', 'folders'], expected: { operation: 'count', groups: [{ collectionSlug: 'folders', count: 2 }] }, retrievals: [] },
  { id: 'count-documents', prompts: prompts('How many extensionless documents are saved?', 'Hur många dokument utan filändelse är sparade?', '¿Cuántos documentos sin extensión están guardados?', '拡張子のない文書はいくつ保存されていますか？'), input: { operation: 'count', collectionSlugs: ['documents'], recordHistory: true, limit: 10 }, facts: ['2', 'documents'], expected: { operation: 'count', groups: [{ collectionSlug: 'documents', count: 2 }] }, retrievals: [] },
  { id: 'count-images', prompts: prompts('How many pictures are in Gallery?', 'Hur många bilder finns i Gallery?', '¿Cuántas imágenes hay en Gallery?', 'Galleryには画像が何枚ありますか？'), input: { operation: 'count', collectionSlugs: ['images'], recordHistory: true, limit: 10 }, facts: ['3', 'images'], expected: { operation: 'count', groups: [{ collectionSlug: 'images', count: 3 }] }, retrievals: [] },
  { id: 'count-completed-trips', prompts: prompts('How many completed trips do I have?', 'Hur många slutförda resor har jag?', '¿Cuántos viajes completados tengo?', '完了した旅行はいくつありますか？'), input: { operation: 'count', collectionSlugs: ['trips'], recordHistory: true, limit: 10, filters: { status: 'completed' } }, facts: ['1', 'completed'], expected: { operation: 'count', groups: [{ collectionSlug: 'trips', count: 1 }] }, retrievals: [] },
  { id: 'count-unread-email', prompts: prompts('How many unread Work emails are there?', 'Hur många olästa Work-mejl finns det?', '¿Cuántos correos no leídos hay en Work?', 'Workの未読メールは何件ありますか？'), input: { operation: 'count', collectionSlugs: ['email-messages'], recordHistory: true, limit: 10, filters: { connectorKey: inboxes[0].connectorKey, readState: 'unread' } }, facts: ['2', 'unread'], expected: { operation: 'count', groups: [{ collectionSlug: 'email-messages', count: 2 }] }, retrievals: [] },
  { id: 'count-favorite-books', prompts: prompts('How many favorite audio books do I have?', 'Hur många favoritljudböcker har jag?', '¿Cuántos audiolibros favoritos tengo?', 'お気に入りのオーディオブックはいくつありますか？'), input: { operation: 'count', collectionSlugs: ['books'], recordHistory: true, limit: 10, filters: { isFavorite: true } }, facts: ['1', 'favorite'], expected: { operation: 'count', groups: [{ collectionSlug: 'books', count: 1 }] }, retrievals: [] },
  { id: 'count-visited-places', prompts: prompts('How many visited places have I saved?', 'Hur många besökta platser har jag sparat?', '¿Cuántos lugares visitados he guardado?', '訪問済みの保存場所はいくつありますか？'), input: { operation: 'count', collectionSlugs: ['places'], recordHistory: true, limit: 10, filters: { status: 'visited' } }, facts: ['1', 'visited'], expected: { operation: 'count', groups: [{ collectionSlug: 'places', count: 1 }] }, retrievals: [] },

  { id: 'sum-folder-bytes', prompts: prompts('How many bytes do documents and files in Project Atlas use?', 'Hur många byte använder dokument och filer i Project Atlas?', '¿Cuántos bytes usan los documentos y archivos de Project Atlas?', 'Project Atlas内の文書とファイルは合計何バイトですか？'), input: { operation: 'sum', collectionSlugs: ['documents', 'files'], field: 'sizeBytes', recordHistory: true, limit: 10, filters: { folderKey: folders[0].key, includeDescendants: true } }, facts: ['1200', '2500', 'bytes'], expected: { operation: 'sum', groups: [{ collectionSlug: 'documents', field: 'sizeBytes', sum: 1_200, unit: 'bytes', matchedCount: 2, valueCount: 1 }, { collectionSlug: 'files', field: 'sizeBytes', sum: 2_500, unit: 'bytes', matchedCount: 1, valueCount: 1 }] }, retrievals: [] },
  { id: 'sum-image-bytes', prompts: prompts('What is the total byte size of my images?', 'Hur stor är den totala storleken i byte för mina bilder?', '¿Cuál es el tamaño total en bytes de mis imágenes?', '画像の合計バイト数は？'), input: { operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', recordHistory: true, limit: 10 }, facts: ['6000000', 'bytes'], expected: { operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 6_000_000, unit: 'bytes', matchedCount: 3, valueCount: 3 }] }, retrievals: [] },
  { id: 'sum-ready-minutes', prompts: prompts('How many listening minutes are in my ready books?', 'Hur många lyssningsminuter finns i mina färdiga böcker?', '¿Cuántos minutos de escucha tienen mis libros listos?', '準備済みの本の総再生時間は何分ですか？'), input: { operation: 'sum', collectionSlugs: ['books'], field: 'estimatedMinutes', recordHistory: true, limit: 10, filters: { status: 'ready' } }, facts: ['75', 'minutes'], expected: { operation: 'sum', groups: [{ collectionSlug: 'books', field: 'estimatedMinutes', sum: 75, unit: 'minutes', matchedCount: 2, valueCount: 2 }] }, retrievals: [] },
  { id: 'sum-favorite-chapters', prompts: prompts('How many chapters are in my favorite books?', 'Hur många kapitel finns i mina favoritböcker?', '¿Cuántos capítulos hay en mis libros favoritos?', 'お気に入りの本には合計何章ありますか？'), input: { operation: 'sum', collectionSlugs: ['books'], field: 'chapterCount', recordHistory: true, limit: 10, filters: { isFavorite: true } }, facts: ['6', 'chapters'], expected: { operation: 'sum', groups: [{ collectionSlug: 'books', field: 'chapterCount', sum: 6, unit: 'chapters', matchedCount: 1, valueCount: 1 }] }, retrievals: [] },

  { id: 'list-books', prompts: prompts('List my audio books.', 'Lista mina ljudböcker.', 'Lista mis audiolibros.', 'オーディオブックを一覧にして。'), input: { operation: 'list', collectionSlugs: ['books'], recordHistory: true, limit: 10 }, facts: ['Systems Thinking', 'Deep Focus', 'Draft Book'], expected: { operation: 'list', groups: [{ collectionSlug: 'books', keys: books.map(({ key }) => key) }] }, retrievals: [] },
  { id: 'list-collections', prompts: prompts('Which Gallery collections do I have?', 'Vilka Gallery-samlingar har jag?', '¿Qué colecciones de Gallery tengo?', 'Galleryのコレクションは何がありますか？'), input: { operation: 'list', collectionSlugs: ['collections'], recordHistory: true, limit: 10 }, facts: ['Coastal Days', 'Family'], expected: { operation: 'list', groups: [{ collectionSlug: 'collections', keys: galleryCollections.map(({ key }) => key) }] }, retrievals: [] },

  { id: 'get-document', prompts: prompts('Open the exact Research Note document.', 'Öppna exakt dokumentet Research Note.', 'Abre el documento exacto Research Note.', 'Research Note文書を正確に開いて。'), input: { operation: 'get', collectionSlugs: ['documents'], key: documents[0].key, recordHistory: true, limit: 10 }, facts: ['Research Note', '18'], expected: { operation: 'get', groups: [{ collectionSlug: 'documents', keys: [documents[0].key] }] }, retrievals: [] },
  { id: 'get-trip', prompts: prompts('Open my Nordic Summer trip.', 'Öppna min resa Nordic Summer.', 'Abre mi viaje Nordic Summer.', 'Nordic Summer旅行を開いて。'), input: { operation: 'get', collectionSlugs: ['trips'], key: trips[0].key, recordHistory: true, limit: 10 }, facts: ['Nordic Summer', 'Stockholm'], expected: { operation: 'get', groups: [{ collectionSlug: 'trips', keys: [trips[0].key] }] }, retrievals: [] },

  { id: 'summarize-document', prompts: prompts('Summarize the Research Note.', 'Sammanfatta Research Note.', 'Resume Research Note.', 'Research Noteを要約して。'), input: { operation: 'summarize', collectionSlugs: ['documents'], key: documents[0].key, recordHistory: true, limit: 10, summary: { style: 'brief' } }, facts: ['cobalt', '18'], expected: { operation: 'summarize', collectionSlug: 'documents', key: documents[0].key, summary: `Summary: ${documents[0].content}` }, retrievals: [] },
  { id: 'summarize-file', prompts: prompts('Summarize the Q4 budget PDF.', 'Sammanfatta Q4-budgetens PDF.', 'Resume el PDF del presupuesto Q4.', 'Q4予算PDFを要約して。'), input: { operation: 'summarize', collectionSlugs: ['files'], key: documents[2].key, recordHistory: true, limit: 10, summary: { style: 'brief' } }, facts: ['42000', 'EUR'], expected: { operation: 'summarize', collectionSlug: 'files', key: documents[2].key, summary: `Summary: ${documents[2].content}` }, retrievals: [] },

  // Quantity language is deliberately varied so the contract covers singular intent and explicit bounds.
  searchScenario({ id: 'limit-singular-document', prompts: prompts('What can you tell me about the Research Note document?', 'Vad kan du berätta om dokumentet Research Note?', '¿Qué puedes decirme del documento Research Note?', 'Research Noteという文書について教えて。'), query: 'Research Note', collectionSlug: 'documents', limit: 1, keys: [documents[0].key], facts: ['Research Note'] }),
  searchScenario({ id: 'limit-one-folder', prompts: prompts('Show me one Atlas folder.', 'Visa mig en Atlas-mapp.', 'Muéstrame una carpeta Atlas.', 'Atlasフォルダーを1つ見せて。'), query: 'Atlas', collectionSlug: 'folders', limit: 1, keys: [folders[0].key], facts: ['Project Atlas'] }),
  searchScenario({ id: 'limit-two-documents', prompts: prompts('Show me two documents from Atlas.', 'Visa två dokument från Atlas.', 'Muestra dos documentos de Atlas.', 'Atlasの文書を2件見せて。'), query: 'Atlas', collectionSlug: 'documents', limit: 2, keys: [documents[0].key, documents[1].key], facts: ['Research Note', 'Meeting Notes'] }),
  searchScenario({ id: 'limit-two-files', prompts: prompts('Find 2 PDF files.', 'Hitta 2 PDF-filer.', 'Busca 2 archivos PDF.', 'PDFファイルを2件探して。'), query: 'pdf', collectionSlug: 'files', limit: 2, keys: [documents[2].key, documents[3].key], facts: ['Q4 Budget.pdf', 'Travel Tickets.pdf'] }),
  searchScenario({ id: 'limit-three-images', prompts: prompts('Show 3 images from Gallery.', 'Visa 3 bilder från Gallery.', 'Muestra 3 imágenes de Gallery.', 'Galleryの画像を3枚見せて。'), query: 'Gothenburg', collectionSlug: 'images', limit: 3, keys: images.map(({ key }) => key), facts: ['3', 'images'] }),
  searchScenario({ id: 'limit-singular-image', prompts: prompts('Which collection contains my orange lighthouse image?', 'Vilken samling innehåller min orange fyrbild?', '¿Qué colección contiene mi imagen del faro naranja?', 'オレンジ色の灯台画像はどのコレクションにありますか？'), query: 'orange lighthouse', collectionSlug: 'images', limit: 1, keys: [images[0].key], facts: ['Coastal Days'] }),
  searchScenario({ id: 'limit-single-family-image', prompts: prompts('Find the single family picnic photo.', 'Hitta det enda familjepicknickfotot.', 'Busca la única foto del pícnic familiar.', '家族のピクニック写真を1枚探して。'), query: 'family picnic', collectionSlug: 'images', limit: 1, keys: [images[2].key], facts: ['Family picnic'] }),
  searchScenario({ id: 'limit-two-collections', prompts: prompts('Show both photo collections.', 'Visa båda fotosamlingarna.', 'Muestra las dos colecciones de fotos.', '写真コレクションを2つとも見せて。'), query: 'photos', collectionSlug: 'collections', limit: 2, keys: galleryCollections.map(({ key }) => key), facts: ['Coastal Days', 'Family'] }),
  searchScenario({ id: 'limit-singular-inbox', prompts: prompts('Tell me about my Work mailbox.', 'Berätta om min Work-brevlåda.', 'Háblame de mi buzón Work.', 'Workメールボックスについて教えて。'), query: 'Work', collectionSlug: 'inboxes', limit: 1, keys: [inboxes[0].key], facts: ['Work'] }),
  searchScenario({ id: 'limit-one-tone', prompts: prompts('Show the direct email tone.', 'Visa e-posttonen Direct.', 'Muestra el tono de correo Direct.', 'Directメールトーンを見せて。'), query: 'Direct', collectionSlug: 'email-tones', limit: 1, keys: [tones[1].key], facts: ['Direct'] }),
  searchScenario({ id: 'limit-singular-message', prompts: prompts('What can you tell me about the launch code email?', 'Vad kan du berätta om mejlet med launch-koden?', '¿Qué puedes decirme del correo del código de lanzamiento?', 'ローンチコードのメールについて教えて。'), query: 'launch code', collectionSlug: 'email-messages', limit: 1, keys: [messages[0].key], facts: ['Launch code'] }),
  searchScenario({ id: 'limit-one-draft', prompts: prompts('Find one budget follow-up draft.', 'Hitta ett budgetuppföljningsutkast.', 'Busca un borrador de seguimiento del presupuesto.', '予算フォローアップの下書きを1件探して。'), query: 'Budget follow-up', collectionSlug: 'email-drafts', limit: 1, keys: [drafts[1].key], facts: ['Budget follow-up'] }),
  searchScenario({ id: 'limit-single-place', prompts: prompts('Tell me about the saved place Stockholm.', 'Berätta om den sparade platsen Stockholm.', 'Háblame del lugar guardado Stockholm.', '保存済みの場所Stockholmについて教えて。'), query: 'Stockholm', collectionSlug: 'places', limit: 1, keys: [stockholm.key], facts: ['Stockholm'] }),
  searchScenario({ id: 'limit-two-trips', prompts: prompts('Find my two trips.', 'Hitta mina två resor.', 'Busca mis dos viajes.', '旅行を2件探して。'), query: 'trip', collectionSlug: 'trips', limit: 2, keys: trips.map(({ key }) => key), facts: ['Nordic Summer', 'Japan Autumn'] }),
  searchScenario({ id: 'limit-singular-book', prompts: prompts('Which book is a practical guide to systems?', 'Vilken bok är en praktisk guide till system?', '¿Qué libro es una guía práctica de sistemas?', 'システムの実践ガイドはどの本ですか？'), query: 'practical guide', collectionSlug: 'books', limit: 1, keys: [books[0].key], facts: ['Systems Thinking'] }),

  // Noisy language, scoped filters, boundaries, inventories, and mixed-resource intent.
  searchScenario({ id: 'edge-misspelled-document', prompts: prompts('Find the documnt called Research Note.', 'Hitta dokumntet Research Note.', 'Busca el documnto Research Note.', 'Research Noteというドキュメン卜を探して。'), query: 'Research Note', collectionSlug: 'documents', limit: 1, keys: [documents[0].key], facts: ['Research Note'] }),
  searchScenario({ id: 'edge-misspelled-file', prompts: prompts('Wheres the Q4 budegt pee dee eff?', 'Var är Q4-budegt-pdf:en?', '¿Dónde está el pee dee eff del presupesto Q4?', 'Q4の予算ピー・ディー・エフはどこ？'), query: 'Q4 Budget', collectionSlug: 'files', limit: 1, keys: [documents[2].key], facts: ['Q4 Budget.pdf'] }),
  searchScenario({ id: 'edge-photo-synonym', prompts: prompts('Locate the sunset lighthouse snapshot.', 'Leta upp ögonblicksbilden av fyren i solnedgången.', 'Localiza la instantánea del faro al atardecer.', '夕暮れの灯台のスナップ写真を探して。'), query: 'lighthouse', collectionSlug: 'images', limit: 1, keys: [images[0].key], facts: ['Orange lighthouse'] }),
  searchScenario({ id: 'edge-album-synonym', prompts: prompts('Find the Family photo album.', 'Hitta fotoalbumet Family.', 'Busca el álbum de fotos Family.', 'Familyの写真アルバムを探して。'), query: 'Family', collectionSlug: 'collections', limit: 1, keys: [galleryCollections[1].key], facts: ['Family'] }),
  searchScenario({ id: 'edge-mailbox-synonym', prompts: prompts('Where is my personal email account?', 'Var är mitt personliga e-postkonto?', '¿Dónde está mi cuenta de correo personal?', '個人用メールアカウントはどこ？'), query: 'Personal', collectionSlug: 'inboxes', limit: 1, keys: [inboxes[1].key], facts: ['Personal', 'personal@example.test'] }),
  searchScenario({ id: 'edge-tone-paraphrase', prompts: prompts('Which writing style says things plainly?', 'Vilken skrivstil uttrycker saker rakt?', '¿Qué estilo de escritura dice las cosas claramente?', '率直に伝える文体はどれ？'), query: 'State the request plainly', collectionSlug: 'email-tones', limit: 1, keys: [tones[1].key], facts: ['Direct'] }),
  searchScenario({ id: 'edge-email-typo', prompts: prompts('Find the quartely reveiw email.', 'Hitta mejlet om quartely reveiw.', 'Busca el correo de la revsión trimestral.', '四半期レヴューのメールを探して。'), query: 'Quarterly review', collectionSlug: 'email-messages', limit: 1, keys: [messages[1].key], facts: ['Quarterly review'] }),
  searchScenario({ id: 'edge-draft-paraphrase', prompts: prompts('Where is the unsent Lisbon travel plan?', 'Var är den oskickade reseplanen för Lisbon?', '¿Dónde está el plan de viaje a Lisbon sin enviar?', '未送信のLisbon旅行計画はどこ？'), query: 'Lisbon itinerary', collectionSlug: 'email-drafts', limit: 1, keys: [drafts[0].key], facts: ['Lisbon itinerary'] }),
  searchScenario({ id: 'edge-place-synonym', prompts: prompts('Find my saved Japanese temple destination.', 'Hitta mitt sparade japanska tempelresmål.', 'Busca mi destino guardado de templos japoneses.', '保存した日本の寺院の行き先を探して。'), query: 'temples', collectionSlug: 'places', limit: 1, keys: [kyoto.key], facts: ['Kyoto'] }),
  searchScenario({ id: 'edge-trip-synonym', prompts: prompts('Find the planned Japan journey.', 'Hitta den planerade Japan-resan.', 'Busca el viaje planeado a Japón.', '計画中の日本旅行を探して。'), query: 'Japan Autumn', collectionSlug: 'trips', limit: 1, keys: [trips[1].key], facts: ['Japan Autumn'] }),
  searchScenario({ id: 'edge-book-paraphrase', prompts: prompts('Find the audiobook about sustained attention.', 'Hitta ljudboken om ihållande uppmärksamhet.', 'Busca el audiolibro sobre atención sostenida.', '持続的な集中力についてのオーディオブックを探して。'), query: 'sustained attention', collectionSlug: 'books', limit: 1, keys: [books[1].key], facts: ['Deep Focus'] }),
  searchScenario({ id: 'edge-folder-paraphrase', prompts: prompts('Where do I keep household receipts?', 'Var förvarar jag hushållskvitton?', '¿Dónde guardo los recibos del hogar?', '家計の領収書はどこに保管していますか？'), query: 'Household receipts', collectionSlug: 'folders', limit: 1, keys: [folders[1].key], facts: ['Receipts'] }),
  { id: 'edge-recent-atlas-document', prompts: prompts('Find the Atlas document created on or after September 3, 2026.', 'Hitta Atlas-dokumentet som skapades den 3 september 2026 eller senare.', 'Busca el documento de Atlas creado el 3 de septiembre de 2026 o después.', '2026年9月3日以降に作成されたAtlasの文書を探して。'), input: { query: 'Atlas', collectionSlugs: ['documents'], recordHistory: true, limit: 1, filters: { createdFrom: at } }, facts: ['Meeting Notes'], expected: { query: 'Atlas', groups: [{ collectionSlug: 'documents', keys: [documents[1].key] }] } },
  { id: 'edge-old-book-boundary', prompts: prompts('Find the book created no later than May 10, 2026.', 'Hitta boken som skapades senast den 10 maj 2026.', 'Busca el libro creado como máximo el 10 de mayo de 2026.', '2026年5月10日までに作成された本を探して。'), input: { query: 'systems', collectionSlugs: ['books'], recordHistory: true, limit: 1, filters: { createdTo: oldAt } }, facts: ['Systems Thinking'], expected: { query: 'systems', groups: [{ collectionSlug: 'books', keys: [books[0].key] }] } },
  { id: 'edge-recent-collection-boundary', prompts: prompts('Show the photo collection created on or after September 3, 2026.', 'Visa fotosamlingen som skapades den 3 september 2026 eller senare.', 'Muestra la colección de fotos creada el 3 de septiembre de 2026 o después.', '2026年9月3日以降に作成された写真コレクションを見せて。'), input: { query: 'photos', collectionSlugs: ['collections'], recordHistory: true, limit: 1, filters: { createdFrom: at } }, facts: ['Family'], expected: { query: 'photos', groups: [{ collectionSlug: 'collections', keys: [galleryCollections[1].key] }] } },
  { id: 'edge-image-inside-collection', prompts: prompts('Find the Gothenburg image inside Coastal Days.', 'Hitta Gothenburg-bilden i Coastal Days.', 'Busca la imagen de Gothenburg dentro de Coastal Days.', 'Coastal Days内のGothenburgの画像を探して。'), input: { query: 'Gothenburg', collectionSlugs: ['images'], recordHistory: true, limit: 1, filters: { collectionKey: galleryCollections[0].key } }, facts: ['Orange lighthouse', 'Coastal Days'], expected: { query: 'Gothenburg', groups: [{ collectionSlug: 'images', keys: [images[0].key] }] } },
  { id: 'edge-count-email-drafts', prompts: prompts('Exactly how many drafts are in Work?', 'Exakt hur många utkast finns i Work?', '¿Exactamente cuántos borradores hay en Work?', 'Workには下書きが正確に何件ありますか？'), input: { operation: 'count', collectionSlugs: ['email-drafts'], recordHistory: true, limit: 10, filters: { connectorKey: inboxes[0].connectorKey } }, facts: ['2', 'drafts'], expected: { operation: 'count', groups: [{ collectionSlug: 'email-drafts', count: 2 }] }, retrievals: [] },
  { id: 'edge-count-old-collections', prompts: prompts('How many photo collections existed by May 10, 2026?', 'Hur många fotosamlingar fanns senast den 10 maj 2026?', '¿Cuántas colecciones de fotos existían el 10 de mayo de 2026?', '2026年5月10日までに写真コレクションはいくつありましたか？'), input: { operation: 'count', collectionSlugs: ['collections'], recordHistory: true, limit: 10, filters: { createdTo: oldAt } }, facts: ['1', 'collections'], expected: { operation: 'count', groups: [{ collectionSlug: 'collections', count: 1 }] }, retrievals: [] },
  { id: 'edge-count-files-in-folder', prompts: prompts('How many files are inside Project Atlas?', 'Hur många filer finns i Project Atlas?', '¿Cuántos archivos hay dentro de Project Atlas?', 'Project Atlas内にファイルはいくつありますか？'), input: { operation: 'count', collectionSlugs: ['files'], recordHistory: true, limit: 10, filters: { folderKey: folders[0].key, includeDescendants: true } }, facts: ['1', 'files'], expected: { operation: 'count', groups: [{ collectionSlug: 'files', count: 1 }] }, retrievals: [] },
  { id: 'edge-list-one-folder', prompts: prompts('Give me the first folder only.', 'Ge mig bara den första mappen.', 'Dame únicamente la primera carpeta.', '最初のフォルダーだけ見せて。'), input: { operation: 'list', collectionSlugs: ['folders'], recordHistory: true, limit: 1 }, facts: ['Project Atlas'], expected: { operation: 'list', groups: [{ collectionSlug: 'folders', keys: [folders[0].key] }] }, retrievals: [] },
  { id: 'edge-list-two-images', prompts: prompts('List only the first two Gallery images.', 'Lista bara de två första Gallery-bilderna.', 'Enumera solo las dos primeras imágenes de Gallery.', 'Galleryの最初の画像2枚だけ一覧にして。'), input: { operation: 'list', collectionSlugs: ['images'], recordHistory: true, limit: 2 }, facts: ['Orange lighthouse', 'Maine coon'], expected: { operation: 'list', groups: [{ collectionSlug: 'images', keys: [images[0].key, images[1].key] }] }, retrievals: [] },
  { id: 'edge-list-one-unread-message', prompts: prompts('Show only one unread email from Work.', 'Visa bara ett oläst mejl från Work.', 'Muestra solo un correo no leído de Work.', 'Workの未読メールを1件だけ見せて。'), input: { operation: 'list', collectionSlugs: ['email-messages'], recordHistory: true, limit: 1, filters: { connectorKey: inboxes[0].connectorKey, readState: 'unread' } }, facts: ['Launch code'], expected: { operation: 'list', groups: [{ collectionSlug: 'email-messages', keys: [messages[0].key] }] }, retrievals: [] },
  { id: 'edge-list-planned-trip', prompts: prompts('Which of my trips are still planned?', 'Vilka av mina resor är fortfarande planerade?', '¿Cuáles de mis viajes siguen planeados?', 'まだ計画中の旅行はどれですか？'), input: { operation: 'list', collectionSlugs: ['trips'], recordHistory: true, limit: 10, filters: { status: 'planned' } }, facts: ['Japan Autumn'], expected: { operation: 'list', groups: [{ collectionSlug: 'trips', keys: [trips[1].key] }] }, retrievals: [] },
  { id: 'edge-list-one-ready-book', prompts: prompts('List one ready audiobook.', 'Lista en färdig ljudbok.', 'Enumera un audiolibro listo.', '準備済みのオーディオブックを1冊挙げて。'), input: { operation: 'list', collectionSlugs: ['books'], recordHistory: true, limit: 1, filters: { status: 'ready' } }, facts: ['Systems Thinking'], expected: { operation: 'list', groups: [{ collectionSlug: 'books', keys: [books[0].key] }] }, retrievals: [] },
  { id: 'edge-cross-document-file', prompts: prompts('Find one Atlas document and one Atlas PDF.', 'Hitta ett Atlas-dokument och en Atlas-PDF.', 'Busca un documento de Atlas y un PDF de Atlas.', 'Atlasの文書を1件とPDFを1件探して。'), input: { query: 'Atlas', collectionSlugs: ['documents', 'files'], recordHistory: true, limit: 1 }, facts: ['Research Note', 'Q4 Budget.pdf'], expected: { query: 'Atlas', groups: [{ collectionSlug: 'documents', keys: [documents[0].key] }, { collectionSlug: 'files', keys: [documents[2].key] }] } },

  // Scope-tag routing uses explicit result limits and exact target mappings in every locale.
  { id: 'tag-search-file', prompts: prompts('Find one file tagged Work about the Q4 budget.', 'Hitta en fil taggad Work om Q4-budgeten.', 'Busca un archivo con la etiqueta Work sobre el presupuesto Q4.', 'Workタグの付いたQ4予算ファイルを1件探して。'), input: { query: 'Q4 Budget', collectionSlugs: ['files'], recordHistory: true, limit: 1, filters: { tagNames: ['Work'], tagMatch: 'any' } }, facts: ['Q4 Budget.pdf', 'Work'], expected: { query: 'Q4 Budget', groups: [{ collectionSlug: 'files', keys: [documents[2].key] }] } },
  { id: 'tag-list-books-any', prompts: prompts('List two books tagged Work or Priority.', 'Lista två böcker taggade Work eller Priority.', 'Enumera dos libros con las etiquetas Work o Priority.', 'WorkまたはPriorityタグの本を2冊一覧にして。'), input: { operation: 'list', collectionSlugs: ['books'], recordHistory: true, limit: 2, filters: { tagNames: ['Work', 'Priority'], tagMatch: 'any' } }, facts: ['Systems Thinking', 'Deep Focus', 'Work'], expected: { operation: 'list', groups: [{ collectionSlug: 'books', keys: [books[0].key, books[1].key] }] }, retrievals: [] },
  { id: 'tag-list-books-all', prompts: prompts('Show one book tagged both Work and Priority.', 'Visa en bok taggad med både Work och Priority.', 'Muestra un libro con las etiquetas Work y Priority.', 'WorkとPriorityの両方のタグが付いた本を1冊見せて。'), input: { operation: 'list', collectionSlugs: ['books'], recordHistory: true, limit: 1, filters: { tagNames: ['Work', 'Priority'], tagMatch: 'all' } }, facts: ['Systems Thinking', 'Work', 'Priority'], expected: { operation: 'list', groups: [{ collectionSlug: 'books', keys: [books[0].key] }] }, retrievals: [] },
  { id: 'tag-key-search-file', prompts: prompts(`Find one Q4 budget file using the explicitly supplied tag ID ${workTag.key}.`, `Hitta en Q4-budgetfil med det uttryckligen angivna tagg-ID:t ${workTag.key}.`, `Busca un archivo del presupuesto Q4 usando el ID de etiqueta proporcionado explícitamente ${workTag.key}.`, `明示されたタグID ${workTag.key} を使ってQ4予算ファイルを1件探して。`), input: { query: 'Q4 Budget', collectionSlugs: ['files'], recordHistory: true, limit: 1, filters: { tagKeys: [workTag.key], tagMatch: 'any' } }, facts: ['Q4 Budget.pdf', 'Work'], expected: { query: 'Q4 Budget', groups: [{ collectionSlug: 'files', keys: [documents[2].key] }] } },
  { id: 'tag-keys-list-books-all', prompts: prompts(`Show one book carrying every explicitly supplied tag ID: ${workTag.key}, ${priorityTag.key}.`, `Visa en bok med alla uttryckligen angivna tagg-ID:n: ${workTag.key}, ${priorityTag.key}.`, `Muestra un libro con todos los ID de etiqueta proporcionados explícitamente: ${workTag.key}, ${priorityTag.key}.`, `明示されたすべてのタグID ${workTag.key}、${priorityTag.key} が付いた本を1冊見せて。`), input: { operation: 'list', collectionSlugs: ['books'], recordHistory: true, limit: 1, filters: { tagKeys: [workTag.key, priorityTag.key], tagMatch: 'all' } }, facts: ['Systems Thinking', 'Work', 'Priority'], expected: { operation: 'list', groups: [{ collectionSlug: 'books', keys: [books[0].key] }] }, retrievals: [] },
  { id: 'tag-count-images', prompts: prompts('How many images are tagged Priority?', 'Hur många bilder är taggade Priority?', '¿Cuántas imágenes tienen la etiqueta Priority?', 'Priorityタグの画像は何枚ありますか？'), input: { operation: 'count', collectionSlugs: ['images'], recordHistory: true, limit: 10, filters: { tagNames: ['Priority'], tagMatch: 'any' } }, facts: ['2', 'images'], expected: { operation: 'count', groups: [{ collectionSlug: 'images', count: 2 }] }, retrievals: [] },
  { id: 'tag-sum-book-minutes', prompts: prompts('How many listening minutes are in books tagged Work?', 'Hur många lyssningsminuter finns i böcker taggade Work?', '¿Cuántos minutos de escucha hay en los libros con la etiqueta Work?', 'Workタグの本の合計再生時間は何分ですか？'), input: { operation: 'sum', collectionSlugs: ['books'], field: 'estimatedMinutes', recordHistory: true, limit: 10, filters: { tagNames: ['Work'], tagMatch: 'any' } }, facts: ['75', 'minutes'], expected: { operation: 'sum', groups: [{ collectionSlug: 'books', field: 'estimatedMinutes', sum: 75, unit: 'minutes', matchedCount: 2, valueCount: 2 }] }, retrievals: [] },
  { id: 'tag-assignments-all', prompts: prompts('What is under both tag Work and tag Priority?', 'Vad finns under både taggen Work och taggen Priority?', '¿Qué hay bajo las etiquetas Work y Priority?', 'WorkとPriorityの両方のタグの下には何がありますか？'), input: { operation: 'list', collectionSlugs: ['tag-assignments'], recordHistory: true, limit: 10, filters: { tagNames: ['Work', 'Priority'], tagMatch: 'all' } }, facts: ['Systems Thinking', 'Work', 'Priority'], expected: { operation: 'list', groups: [{ collectionSlug: 'tag-assignments', keys: [id(141), id(142)] }] }, retrievals: [] },
  { id: 'tag-search-tags', prompts: prompts('Find the tag for professional projects.', 'Hitta taggen för professionella projekt.', 'Busca la etiqueta para proyectos profesionales.', '仕事のプロジェクト用タグを探して。'), input: { query: 'professional projects', collectionSlugs: ['tags'], recordHistory: true, limit: 1 }, facts: ['Work', 'Professional projects'], expected: { query: 'professional projects', groups: [{ collectionSlug: 'tags', keys: [workTag.key] }] } },
  { id: 'tag-list-tags', prompts: prompts('List my tags.', 'Lista mina taggar.', 'Enumera mis etiquetas.', 'タグを一覧にして。'), input: { operation: 'list', collectionSlugs: ['tags'], recordHistory: true, limit: 10 }, facts: ['Work', 'Priority'], expected: { operation: 'list', groups: [{ collectionSlug: 'tags', keys: [workTag.key, priorityTag.key] }] }, retrievals: [] },
  { id: 'tag-count-tags', prompts: prompts('How many tags do I have?', 'Hur många taggar har jag?', '¿Cuántas etiquetas tengo?', 'タグはいくつありますか？'), input: { operation: 'count', collectionSlugs: ['tags'], recordHistory: true, limit: 10 }, facts: ['2', 'tags'], expected: { operation: 'count', groups: [{ collectionSlug: 'tags', count: 2 }] }, retrievals: [] },
  { id: 'tag-get-tag', prompts: prompts('Show the exact Work tag from the current result.', 'Visa den exakta Work-taggen från det aktuella resultatet.', 'Muestra la etiqueta Work exacta del resultado actual.', '現在の結果から正確なWorkタグを表示して。'), input: { operation: 'get', collectionSlugs: ['tags'], key: workTag.key, recordHistory: true, limit: 1 }, facts: ['Work', 'Professional projects'], expected: { operation: 'get', groups: [{ collectionSlug: 'tags', keys: [workTag.key] }] }, retrievals: [] },

  // These answers exercise presentation of dates, sizes, booleans, and enums without leaking storage representation.
  searchScenario({ id: 'present-folder-date', prompts: prompts('When was Project Atlas created?', 'När skapades Project Atlas?', '¿Cuándo se creó Project Atlas?', 'Project Atlasはいつ作成されましたか？'), query: 'Project Atlas', collectionSlug: 'folders', limit: 1, keys: [folders[0].key], facts: ['Project Atlas', '2026'], answers: prompts('Project Atlas was created on May 10, 2026.', 'Project Atlas skapades den 10 maj 2026.', 'Project Atlas se creó el 10 de mayo de 2026.', 'Project Atlasは2026年5月10日に作成されました。'), forbiddenAnswerFragments: [oldAt, 'createdAt'] }),
  searchScenario({ id: 'present-document-date', prompts: prompts('When was Research Note last updated?', 'När uppdaterades Research Note senast?', '¿Cuándo se actualizó Research Note por última vez?', 'Research Noteの最終更新日はいつですか？'), query: 'Research Note', collectionSlug: 'documents', limit: 1, keys: [documents[0].key], facts: ['Research Note', '2026'], answers: prompts('Research Note was last updated on September 3, 2026.', 'Research Note uppdaterades senast den 3 september 2026.', 'Research Note se actualizó por última vez el 3 de septiembre de 2026.', 'Research Noteの最終更新日は2026年9月3日です。'), forbiddenAnswerFragments: [at, 'updatedAt'] }),
  searchScenario({ id: 'present-file-size', prompts: prompts('How large is the Q4 Budget PDF?', 'Hur stor är PDF-filen Q4 Budget?', '¿Qué tamaño tiene el PDF Q4 Budget?', 'Q4 Budget PDFのサイズは？'), query: 'Q4 Budget', collectionSlug: 'files', limit: 1, keys: [documents[2].key], facts: ['Q4 Budget.pdf', '2500'], answers: prompts('Q4 Budget.pdf is 2.5 KB.', 'Q4 Budget.pdf är 2,5 KB.', 'Q4 Budget.pdf ocupa 2,5 KB.', 'Q4 Budget.pdfは2.5 KBです。'), forbiddenAnswerFragments: ['2500', 'sizeBytes'] }),
  searchScenario({ id: 'present-collection-favorite', prompts: prompts('Is Coastal Days a favorite collection?', 'Är Coastal Days en favoritsamling?', '¿Coastal Days es una colección favorita?', 'Coastal Daysはお気に入りのコレクションですか？'), query: 'Coastal Days', collectionSlug: 'collections', limit: 1, keys: [galleryCollections[0].key], facts: ['Coastal Days'], answers: prompts('Yes, Coastal Days is a favorite collection.', 'Ja, Coastal Days är en favoritsamling.', 'Sí, Coastal Days es una colección favorita.', 'はい、Coastal Daysはお気に入りのコレクションです。'), forbiddenAnswerFragments: ['isFavorite', 'true'] }),
  searchScenario({ id: 'present-image-size', prompts: prompts('How large is the lighthouse image?', 'Hur stor är fyrbilden?', '¿Qué tamaño tiene la imagen del faro?', '灯台画像のサイズは？'), query: 'lighthouse', collectionSlug: 'images', limit: 1, keys: [images[0].key], facts: ['3000000'], answers: prompts('The lighthouse image is 3 MB.', 'Fyrbilden är 3 MB.', 'La imagen del faro ocupa 3 MB.', '灯台画像は3 MBです。'), forbiddenAnswerFragments: ['3000000', 'sizeBytes'] }),
  searchScenario({ id: 'present-image-date', prompts: prompts('When was the family picnic image added?', 'När lades familjepicknickbilden till?', '¿Cuándo se añadió la imagen del pícnic familiar?', '家族のピクニック画像はいつ追加されましたか？'), query: 'family picnic', collectionSlug: 'images', limit: 1, keys: [images[2].key], facts: ['2026'], answers: prompts('The family picnic image was added on September 3, 2026.', 'Familjepicknickbilden lades till den 3 september 2026.', 'La imagen del pícnic familiar se añadió el 3 de septiembre de 2026.', '家族のピクニック画像は2026年9月3日に追加されました。'), forbiddenAnswerFragments: [at, 'createdAt'] }),
  searchScenario({ id: 'present-inbox-sync-date', prompts: prompts('When did the Work mailbox last sync?', 'När synkroniserades Work-brevlådan senast?', '¿Cuándo se sincronizó por última vez el buzón Work?', 'Workメールボックスが最後に同期されたのはいつですか？'), query: 'Work', collectionSlug: 'inboxes', limit: 1, keys: [inboxes[0].key], facts: ['Work', '2026'], answers: prompts('The Work mailbox last synced on September 3, 2026.', 'Work-brevlådan synkroniserades senast den 3 september 2026.', 'El buzón Work se sincronizó por última vez el 3 de septiembre de 2026.', 'Workメールボックスの最終同期日は2026年9月3日です。'), forbiddenAnswerFragments: [at, 'lastSyncedAt'] }),
  searchScenario({ id: 'present-tone-favorite', prompts: prompts('Is the Warm email tone a favorite?', 'Är e-posttonen Warm en favorit?', '¿El tono de correo Warm es favorito?', 'Warmメールトーンはお気に入りですか？'), query: 'Warm', collectionSlug: 'email-tones', limit: 1, keys: [tones[0].key], facts: ['Warm'], answers: prompts('Yes, Warm is a favorite email tone.', 'Ja, Warm är en favoritton för e-post.', 'Sí, Warm es un tono de correo favorito.', 'はい、Warmはお気に入りのメールトーンです。'), forbiddenAnswerFragments: ['isFavorite', 'true'] }),
  searchScenario({ id: 'present-message-state', prompts: prompts('What state is the launch code email in?', 'Vilken status har mejlet med launch-koden?', '¿En qué estado está el correo del código de lanzamiento?', 'ローンチコードのメールはどの状態ですか？'), query: 'launch code', collectionSlug: 'email-messages', limit: 1, keys: [messages[0].key], facts: ['Launch code'], answers: prompts('The launch code email needs action.', 'Mejlet med launch-koden behöver åtgärdas.', 'El correo del código de lanzamiento requiere una acción.', 'ローンチコードのメールには対応が必要です。'), forbiddenAnswerFragments: ['needs_action', 'state'] }),
  searchScenario({ id: 'present-draft-status', prompts: prompts('What is the status of the budget follow-up draft?', 'Vilken status har budgetuppföljningsutkastet?', '¿Cuál es el estado del borrador de seguimiento del presupuesto?', '予算フォローアップの下書きの状態は？'), query: 'Budget follow-up', collectionSlug: 'email-drafts', limit: 1, keys: [drafts[1].key], facts: ['Budget follow-up'], answers: prompts('The budget follow-up draft has been edited.', 'Budgetuppföljningsutkastet har redigerats.', 'El borrador de seguimiento del presupuesto está editado.', '予算フォローアップの下書きは編集済みです。'), forbiddenAnswerFragments: ['status'] }),
  searchScenario({ id: 'present-place-status', prompts: prompts('Have I visited Stockholm?', 'Har jag besökt Stockholm?', '¿He visitado Estocolmo?', 'Stockholmには訪問済みですか？'), query: 'Stockholm', collectionSlug: 'places', limit: 1, keys: [stockholm.key], facts: ['Stockholm'], answers: prompts('Yes, Stockholm is marked as visited.', 'Ja, Stockholm är markerat som besökt.', 'Sí, Estocolmo está marcado como visitado.', 'はい、Stockholmは訪問済みです。'), forbiddenAnswerFragments: ['status'] }),
  searchScenario({ id: 'present-trip-status', prompts: prompts('What is the status of Nordic Summer?', 'Vilken status har Nordic Summer?', '¿Cuál es el estado de Nordic Summer?', 'Nordic Summerの状況は？'), query: 'Nordic Summer', collectionSlug: 'trips', limit: 1, keys: [trips[0].key], facts: ['Nordic Summer'], answers: prompts('Nordic Summer is completed.', 'Nordic Summer är slutförd.', 'Nordic Summer está completado.', 'Nordic Summerは完了しています。'), forbiddenAnswerFragments: ['status'] }),
  searchScenario({ id: 'present-book-progress', prompts: prompts('How far am I through Systems Thinking?', 'Hur långt har jag kommit i Systems Thinking?', '¿Cuánto he avanzado en Systems Thinking?', 'Systems Thinkingはどこまで進みましたか？'), query: 'Systems Thinking', collectionSlug: 'books', limit: 1, keys: [books[0].key], facts: ['Systems Thinking', '50'], answers: prompts('You are 50% through Systems Thinking.', 'Du har kommit 50 % genom Systems Thinking.', 'Has avanzado un 50 % en Systems Thinking.', 'Systems Thinkingは50%まで進んでいます。'), forbiddenAnswerFragments: ['progressPercent'] }),
  searchScenario({ id: 'present-book-duration', prompts: prompts('How long is Deep Focus?', 'Hur lång är Deep Focus?', '¿Cuánto dura Deep Focus?', 'Deep Focusの長さは？'), query: 'Deep Focus', collectionSlug: 'books', limit: 1, keys: [books[1].key], facts: ['Deep Focus', '30'], answers: prompts('Deep Focus is about 30 minutes long.', 'Deep Focus är cirka 30 minuter lång.', 'Deep Focus dura unos 30 minutos.', 'Deep Focusの長さは約30分です。'), forbiddenAnswerFragments: ['estimatedMinutes'] }),
  searchScenario({ id: 'present-book-date', prompts: prompts('When was Systems Thinking created?', 'När skapades Systems Thinking?', '¿Cuándo se creó Systems Thinking?', 'Systems Thinkingはいつ作成されましたか？'), query: 'Systems Thinking', collectionSlug: 'books', limit: 1, keys: [books[0].key], facts: ['Systems Thinking', '2026'], answers: prompts('Systems Thinking was created on May 10, 2026.', 'Systems Thinking skapades den 10 maj 2026.', 'Systems Thinking se creó el 10 de mayo de 2026.', 'Systems Thinkingは2026年5月10日に作成されました。'), forbiddenAnswerFragments: [oldAt, 'createdAt'] }),
];

const evaluationCases = scenarios.flatMap((scenario) => locales.map(({ locale, marker }) => ({
  ...scenario,
  locale,
  name: `${scenario.id} [${locale}]`,
  prompt: scenario.prompts[locale],
  answer: scenario.answers?.[locale] ?? `${marker}: ${scenario.facts.join(', ')}.`,
  answerFacts: scenario.answers ? [] : [marker, ...scenario.facts],
})));

const rawAnswerFragments = [
  organizationKey, scopeKey, userKey, membershipKey, conversationKey,
  ...folders.map(({ key }) => key), ...documents.map(({ key }) => key), ...galleryCollections.map(({ key }) => key),
  ...images.map(({ key }) => key), ...inboxes.flatMap(({ key, connectorKey }) => [key, connectorKey]),
  ...tones.map(({ key }) => key), ...messages.flatMap(({ key, connectorKey }) => [key, connectorKey]),
  ...drafts.flatMap(({ key, connectorKey }) => [key, connectorKey]), ...places.map(({ key }) => key),
  ...trips.map(({ key }) => key), ...books.map(({ key }) => key), workTag.key, priorityTag.key,
  'scopeKey', 'connectorKey', 'collectionSlug', 'collectionSlugs',
];

function providerQueue(responses: ProviderStreamChunk[][], inputs: CoreChatInput[]) {
  return async function* (_organization: string, input: CoreChatInput) {
    inputs.push(input);
    const response = responses.shift();
    if (!response) throw new Error('The deterministic provider received an unexpected request.');
    for (const chunk of response) yield chunk;
  };
}

function normalized(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[\s_,.:;!?¿¡。、「」]+/g, ' ').trim();
}

function createRepositoryCapture() {
  let assistant: ConversationMessage | undefined;
  let completed: ConversationMessage | undefined;
  const repository = {
    beginTurn: async (_owner: unknown, _conversation: string, user: ConversationMessage, pending: ConversationMessage) => { assistant = pending; return { state: 'created' as const, user, assistant: pending, first: false }; },
    latestCompletedMessages: async () => [],
    setMessageEmbedding: async () => true,
    completeTurn: async (_owner: unknown, _conversation: string, _assistantKey: string, content: string, savedEmbedding: number[] | undefined, retrievals: AppSearchRetrieval[], completedAt: string) => {
      completed = { ...assistant!, content, embedding: savedEmbedding, retrievals, status: 'COMPLETED', completedAt };
      return { message: completed, nameApplied: false };
    },
    failTurn: async () => {},
  } as unknown as ConversationRepository;
  return { repository, completed: () => completed };
}

describe('Core App Search deterministic evaluation', () => {
  test('defines more than 100 isolated multilingual questions with full operation and collection coverage', () => {
    expect(evaluationCases.length).toBe(404);
    expect(evaluationCases.length - 256).toBeGreaterThanOrEqual(100);
    expect(new Set(evaluationCases.map(({ prompt }) => prompt)).size).toBe(evaluationCases.length);
    expect(evaluationCases.filter(({ input }) => input).every(({ input }) => Number.isInteger(input!.limit) && input!.limit >= 1 && input!.limit <= 50)).toBe(true);
    expect(new Set(scenarios.flatMap(({ input }) => input?.collectionSlugs ?? []))).toEqual(new Set(['folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places', 'trips', 'countries', 'books', 'tags', 'tag-assignments']));
    expect(new Set(scenarios.flatMap(({ input }) => input ? [input.operation ?? 'search'] : []))).toEqual(new Set(['search', 'list', 'count', 'sum', 'get', 'summarize']));
  });

  for (const evaluation of evaluationCases) test(evaluation.name, async () => {
    const inputs: CoreChatInput[] = [];
    const rawResults: AppSearchResult[] = [];
    const calls: unknown[] = [];
    const appSearch = createSeededAppSearchService();
    const wrappedAppSearch = {
      search: async (raw: unknown, suppliedContext: ToolContext) => {
        calls.push(raw);
        const result = await appSearch.search(raw, suppliedContext);
        rawResults.push(result);
        return result;
      },
    } as never;
    const done: ProviderStreamChunk = { type: 'done' };
    const responses: ProviderStreamChunk[][] = evaluation.input ? [
      [{ type: 'text-delta', text: '{"tools":["app.search"],"message":""}' }, done],
      [{ type: 'tool-call', toolCall: { id: evaluation.name, name: 'app.search', arguments: evaluation.input } }, done],
      [{ type: 'text-delta', text: JSON.stringify({ tools: [], message: evaluation.answer }) }, done],
    ] : [[{ type: 'text-delta', text: JSON.stringify({ tools: [], message: evaluation.answer }) }, done]];
    const { repository, completed } = createRepositoryCapture();
    const events: ConversationTurnEvent[] = [];
    const appSearchDefinition = TOOL_DEFINITIONS.find(({ name }) => name === 'app.search');
    if (!appSearchDefinition) throw new Error('app.search is not registered.');
    await createConversationService({
      repository,
      now: () => at,
      id: (() => { let next = 500; return () => id(next++); })(),
      embed: async () => embedding,
      agent: {
        stream: providerQueue(responses, inputs),
        tools: { names: ['app.search'], definitions: [appSearchDefinition], dependencies: { appSearchService: wrappedAppSearch } },
      },
    }).turn({ conversationKey, message: evaluation.prompt, requestKey: evaluation.name }, context, (event) => { events.push(event); });

    const saved = completed();
    expect(saved?.content).toBe(evaluation.answer);
    const semanticAnswer = normalized(saved?.content ?? '');
    for (const fact of evaluation.answerFacts) expect(semanticAnswer).toContain(normalized(fact));
    for (const fragment of [...rawAnswerFragments, ...(evaluation.forbiddenAnswerFragments ?? [])]) expect(saved?.content).not.toContain(fragment);
    expect(events.map(({ type }) => type)).toEqual(evaluation.input ? ['start', 'delta', 'done'] : ['start', 'delta', 'done']);
    expect(responses).toHaveLength(0);
    if (!evaluation.input) {
      expect(calls).toEqual([]);
      expect(rawResults).toEqual([]);
      expect(saved?.retrievals).toEqual([]);
      expect(inputs).toHaveLength(1);
      return;
    }
    expect(calls).toEqual([evaluation.input]);
    expect(rawResults).toHaveLength(1);
    expect(resultSignature(rawResults[0]!)).toEqual(evaluation.expected!);
    if (evaluation.retrievals) expect(saved?.retrievals).toEqual(evaluation.retrievals);
    else {
      expect(saved?.retrievals?.every(({ limit, groups }) => limit === evaluation.input!.limit && groups.every(({ results }) => results.length <= limit))).toBe(true);
    }
    expect(inputs).toHaveLength(3);
    expect(inputs[2]!.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'app.search', status: 'succeeded' } });
    const groundedContext = normalized(JSON.stringify(inputs[2]!.messages));
    for (const fact of evaluation.facts) expect(groundedContext).toContain(normalized(fact));
  });
});
