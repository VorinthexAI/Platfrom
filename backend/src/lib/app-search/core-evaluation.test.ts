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

function contains(value: unknown, query: string) {
  return JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function inDateRange<T extends { createdAt?: string }>(items: readonly T[], input: { createdFrom?: string; createdTo?: string }) {
  return items.filter(({ createdAt }) => (!input.createdFrom || Boolean(createdAt && createdAt >= input.createdFrom)) && (!input.createdTo || Boolean(createdAt && createdAt <= input.createdTo)));
}

function createSeededAppSearchService() {
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
type Scenario = { id: string; prompts: Prompts; input?: AppSearchInput; facts: string[]; expected?: Signature; retrievals?: AppSearchRetrieval[]; directAnswers?: Prompts };

function resultSignature(result: AppSearchResult): Signature {
  if ('query' in result) return { query: result.query, groups: result.groups.map(({ collectionSlug, results }) => ({ collectionSlug, keys: results.map((item) => collectionSlug === 'countries' ? (item as { countryCode: string }).countryCode : (item as { key: string }).key) })) };
  if (result.operation === 'count') return result;
  if (result.operation === 'sum') return result;
  if (result.operation === 'summarize') return result;
  return { operation: result.operation, groups: result.groups.map(({ collectionSlug, results, totalCount }) => ({ collectionSlug, keys: results.map((item: any) => item.key), ...(totalCount === undefined ? {} : { totalCount }) })) };
}

const scenarios: Scenario[] = [
  { id: 'general-capital', prompts: prompts('What is the capital of France?', 'Vad är Frankrikes huvudstad?', '¿Cuál es la capital de Francia?', 'フランスの首都はどこですか？'), facts: ['Paris'], directAnswers: prompts('Paris is the capital of France.', 'Paris är Frankrikes huvudstad.', 'París es la capital de Francia.', 'フランスの首都はパリ（Paris）です。') },
  { id: 'general-arithmetic', prompts: prompts('What is 17 plus 25?', 'Vad är 17 plus 25?', '¿Cuánto es 17 más 25?', '17足す25はいくつですか？'), facts: ['42'], directAnswers: prompts('17 plus 25 is 42.', '17 plus 25 är 42.', '17 más 25 es 42.', '17足す25は42です。') },
  { id: 'general-writing', prompts: prompts('Give me a short synonym for quick.', 'Ge mig en kort synonym till snabb.', 'Dame un sinónimo corto de rápido.', '「速い」の短い類義語を教えてください。'), facts: ['fast'], directAnswers: prompts('A short synonym is fast.', 'En kort engelsk synonym är fast.', 'Un sinónimo corto en inglés es fast.', '短い英語の類義語は fast です。') },
  { id: 'general-date', prompts: prompts('What year is in the current date?', 'Vilket år är det i dagens datum?', '¿Qué año aparece en la fecha actual?', '現在の日付は何年ですか？'), facts: ['2026'], directAnswers: prompts('The current year is 2026.', 'Det nuvarande året är 2026.', 'El año actual es 2026.', '現在の年は2026年です。') },

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
];

const evaluationCases = scenarios.flatMap((scenario) => locales.map(({ locale, marker }) => ({
  ...scenario,
  locale,
  name: `${scenario.id} [${locale}]`,
  prompt: scenario.prompts[locale],
  answer: scenario.directAnswers?.[locale] ?? `${marker}: ${scenario.facts.join(', ')}.`,
  answerFacts: scenario.directAnswers ? scenario.facts : [marker, ...scenario.facts],
})));

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
    expect(evaluationCases.length).toBe(136);
    expect(new Set(evaluationCases.map(({ prompt }) => prompt)).size).toBe(evaluationCases.length);
    expect(new Set(scenarios.flatMap(({ input }) => input?.collectionSlugs ?? []))).toEqual(new Set(['folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places', 'trips', 'countries', 'books']));
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
    expect(saved?.retrievals).toEqual(evaluation.retrievals);
    expect(inputs).toHaveLength(3);
    expect(inputs[2]!.messages.at(-1)?.content[0]).toMatchObject({ type: 'tool-result', result: { slug: 'app.search', status: 'succeeded' } });
    const groundedContext = normalized(JSON.stringify(inputs[2]!.messages));
    for (const fact of evaluation.facts) expect(groundedContext).toContain(normalized(fact));
  });
});
