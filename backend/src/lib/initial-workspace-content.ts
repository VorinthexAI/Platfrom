import { z } from 'zod';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { folderSchema, type Folder } from '@/lib/db/folders.node';
import { embedTexts } from '@/lib/embeddings';
import { sanitizeDocumentContent } from '@/lib/ai/document-processing/actions';
import { chunkDocumentContent, documentEmbeddingTexts, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { initialWorkspaceContentRepository, type InitialWorkspaceContentRepository } from '@/lib/initial-workspace-content-repository';
import { initialWorkspaceBookChapterKey, initialWorkspaceBookKey, initialWorkspaceDocumentKey, initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import { bookSchema } from '@/lib/db/books.node';
import { BOOK_CHAPTER_WORD_MAX, BOOK_CHAPTER_WORD_MIN, bookChapterSchema } from '@/lib/db/book-chapters.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { INITIAL_AUDIOBOOK_ASSET_MANIFEST, INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS } from '@/lib/initial-audiobook-assets';

export const INITIAL_WORKSPACE_CONTENT_VERSION = 7;

type GuideDocument = { id: string; folderId: string; name: string; content: string; introducedInVersion: number };
type GuideFolder = { id: string; parentId?: string; name: string; description: string; presentation: NonNullable<Folder['presentation']>; introducedInVersion: number };

const folderDefinitions = [
  { id: 'platform', name: 'Vorinthex AI', description: 'A guide to Vorinthex AI, Core, and the connected workspace.', presentation: 'platform', introducedInVersion: 3 },
  { id: 'assistant', parentId: 'platform', name: 'Core', description: 'Understand the conversational center for questions, search, and navigation.', presentation: 'assistant', introducedInVersion: 3 },
  { id: 'knowledge', parentId: 'platform', name: 'Archive', description: 'Understand the knowledge workspace and how it connects with Core.', presentation: 'knowledge', introducedInVersion: 3 },
  { id: 'media', parentId: 'platform', name: 'Gallery', description: 'Understand the visual workspace and connected image generation.', presentation: 'media', introducedInVersion: 3 },
  { id: 'communication', parentId: 'platform', name: 'Signal', description: 'Understand your private inbox for connected email and communication from Vorinthex AI apps and support.', presentation: 'communication', introducedInVersion: 7 },
  { id: 'travel', parentId: 'platform', name: 'Compass', description: 'Understand the travel workspace and connected planning tools.', presentation: 'travel', introducedInVersion: 3 },
  { id: 'learning', parentId: 'platform', name: 'Ascend', description: 'Understand the learning workspace and connected audio books.', presentation: 'learning', introducedInVersion: 3 },
] as const;
export const INITIAL_WORKSPACE_FOLDERS: readonly GuideFolder[] = folderDefinitions;

const documentDefinitions = [
  {
    id: 'platform-welcome', folderId: 'platform', name: 'Welcome to Vorinthex AI',
    content: `Vorinthex AI brings knowledge, images, communication, travel, learning, and conversation into one connected workspace. Each app has a focused purpose while sharing a consistent account and experience.

Core is the conversational starting point. Use it to ask questions, search available workspace information, and open useful results in the app where they belong. You remain in control of every app and its actions.

Sparks are your prepaid balance for AI capabilities, stored work, and connected services. Some capabilities use a fixed Spark cost, while other AI usage varies. Your current balance appears in the app header, and the Sparks screen explains current charge categories.`,
  },
  {
    id: 'platform-purpose', folderId: 'platform', name: 'Why Vorinthex AI Exists',
    content: `Digital life is often divided between separate apps, subscriptions, and stores of context. Each tool solves one narrow problem, leaving people to remember where information lives and how the pieces relate.

Vorinthex AI gives specialized activities one connected home. Archive, Gallery, Signal, Compass, Ascend, and Core keep clear responsibilities while using a shared workspace and identity.

The goal is not to add another disconnected destination. It is to reduce repeated setup, scattered context, and unnecessary switching. As the workspace grows, saved documents, images, messages, places, and books become easier to find and understand together.`,
  },
  {
    id: 'platform-connections', folderId: 'platform', name: 'How Core Connects Everything',
    content: `Core provides a conversational view across the parts of Vorinthex AI that are available to the current request. It can answer general questions and search connected workspace information without requiring exact filenames or locations.

Search results can point to documents in Archive, images in Gallery, communication in Signal, places in Compass, and books in Ascend. Selecting a result opens the relevant app so you can continue there.

Core does not replace each app or make changes on your behalf. The focused apps remain where you organize content and control actions. Core makes the connected workspace easier to understand and navigate.`,
  },
  {
    id: 'assistant-overview', folderId: 'assistant', name: 'What Core Is',
    content: `Core is the conversational center of Vorinthex AI. It provides a familiar place to ask general questions and discuss ideas in natural language.

When authorized workspace information is relevant, Core can search across connected apps and present matching results. Those results can include documents, images, messages, places, trips, and audio books.

Core is designed for understanding and discovery rather than silently changing your workspace. Selecting a result takes you to the responsible app, where available controls remain visible and deliberate. This keeps conversation convenient while preserving clear ownership of every action.`,
  },
  {
    id: 'assistant-purpose', folderId: 'assistant', name: 'Why We Built Core',
    content: `We built Core because connected apps need one clear place for questions. Without a shared conversational surface, people still have to remember which app contains each piece of information.

Core can search the workspace context available to a request and explain what it finds. It helps reveal relationships between information while keeping each app focused on its own purpose.

The separation is intentional. Core supports conversation, search, and navigation, while app specific controls govern changes to documents, images, messages, trips, and books. This creates a useful common entry point without hiding where actions happen or who controls them.`,
  },
  {
    id: 'assistant-start', folderId: 'assistant', name: 'Your First Steps with Core',
    content: `Open Core and begin with a direct question. You can ask about a general topic or describe something you want to locate in your Vorinthex AI workspace.

Try searching for a document by its subject rather than its exact title. You can also look for an image, message, place, trip, or audio book using the details you remember.

Review the returned information and select a result when you want to continue in its app. Keep requests specific when context matters, and confirm that the relevant workspace sources are available. Core is most useful as a clear conversational guide to information you control.`,
  },
  {
    id: 'knowledge-overview', folderId: 'knowledge', name: 'What Archive Is',
    content: `Archive is the knowledge home inside Vorinthex AI. It keeps documents, notes, uploaded files, folders, and written context in one organized workspace.

Use Archive for research, project material, references, plans, ideas, or anything you may want to find again. Familiar folders provide structure, while semantic search helps locate material by meaning.

Authorized Archive content can also appear in Core search results. This makes Archive a durable knowledge layer for the wider workspace without removing your control over organization, editing, and access. Information remains available beyond a single conversation and can support later reading or discovery.`,
  },
  {
    id: 'knowledge-purpose', folderId: 'knowledge', name: 'Why We Built Archive',
    content: `We built Archive because a connected workspace needs a dependable knowledge foundation. Separate note, storage, and search tools leave people remembering which service contains each answer.

Archive keeps familiar folders and documents while adding semantic discovery. Knowledge does not need to disappear inside old conversations or remain scattered across unrelated locations.

Saved information can remain useful for future questions, communication, travel, and learning. Archive represents the future of apps we believe in: information becomes more valuable when it stays organized, searchable, and connected to the wider workspace. The user still decides what to save, edit, move, share, or remove.`,
  },
  {
    id: 'knowledge-start', folderId: 'knowledge', name: 'Your First Steps in Archive',
    content: `Begin by creating a folder for a project, subject, goal, or collection of ideas. Add a short document or upload a supported file that you want to keep.

Use folders when structure matters, then try Archive search with a phrase that describes the content rather than its exact title. Open a result to read, edit, tag, or organize it.

As the workspace grows, Archive becomes more valuable because useful information remains available and searchable. Core can surface authorized Archive results during a conversation, and selecting one returns you to Archive. You retain control of every document and folder.`,
  },
  {
    id: 'media-overview', folderId: 'media', name: 'What Gallery Is',
    content: `Gallery is the visual home inside Vorinthex AI. It stores uploaded pictures, generated images, collections, memories, and highlights in one focused workspace.

You can organize images into collections, choose covers, mark favorites, apply tags, and search by visible content or available place information. Generated visuals remain available beyond the conversation or request that created them.

Gallery gives visual material a durable and searchable home beside your documents and ideas. Authorized Gallery results can appear in Core search, then open directly in Gallery. This makes images easier to revisit, understand, and reuse while keeping visual controls in the app designed for them.`,
  },
  {
    id: 'media-purpose', folderId: 'media', name: 'Why We Built Gallery',
    content: `We built Gallery because image creation and image organization are often separated. Valuable visuals become buried in conversations, scattered across downloads, or detached from the ideas that gave them meaning.

Gallery keeps uploads and generated images in a visual library with collections, search, tags, memories, and highlights. The result remains useful after the moment it was added.

A visual can stay connected to a document, trip, message, or learning project inside Vorinthex AI. Gallery shows why a unified workspace matters: creating, finding, and managing visual material should feel continuous rather than requiring several unrelated services and repeated transfers.`,
  },
  {
    id: 'media-start', folderId: 'media', name: 'Your First Steps in Gallery',
    content: `Start by uploading a picture or creating a collection for an idea, place, project, event, or story. Give related images one clear home as the collection grows.

Try searching for an image by describing what appears in it rather than remembering its filename. Add tags or favorites when you want another way to return to important visuals.

Explore memories and highlights after your library contains related images. Gallery becomes more useful as a visual memory where creations and references remain organized. Core search can surface authorized images, but Gallery stays the place where you review and manage them.`,
  },
  {
    id: 'communication-overview', folderId: 'communication', name: 'What Signal Is',
    content: `Signal is your private communication inbox inside Vorinthex AI. It brings connected email together with communication from Vorinthex AI apps and support, giving important conversations one focused home.

Connected email can be organized into useful views, while search helps locate messages by meaning. Signal can retain summaries, translations, writing tones, and reply context where those features are available. App communication and support replies can reach the same private inbox without becoming mixed into unrelated tools.

You remain in control of every draft and send action. Authorized communication results can appear in Core search and open in Signal for review. This keeps communication connected to the wider workspace without treating a conversation as permission to change or send anything.`,
  },
  {
    id: 'communication-purpose', folderId: 'communication', name: 'Why We Built Signal',
    content: `We built Signal because communication often sits apart from the rest of a digital workspace. Connected email, app updates, and support conversations contain decisions, commitments, relationships, and useful context, yet they usually arrive in separate places.

Signal gives that communication one private inbox. It provides focused tools for finding connected email, understanding threads, managing drafts, and reviewing attachments. Communication from Vorinthex AI apps and support can stay close to the workspace it concerns instead of becoming another disconnected stream.

This is what connected apps can enable: communication becomes part of one coherent system while retaining strict controls. You choose connected accounts, review generated drafts, and explicitly decide what is sent. Core may surface authorized results, but Signal remains the private home responsible for communication actions.`,
  },
  {
    id: 'communication-start', folderId: 'communication', name: 'Your First Steps in Signal',
    content: `Open Signal to see your private inbox for connected email and communication from Vorinthex AI apps and support. Connect an email account when ready, then allow Signal to synchronize available conversations.

Open a thread to review its messages and available actions. Try searching with a subject, sender, or idea you remember from the conversation. When connected email drafting is available, choose an appropriate writing tone and review the complete result before sending.

Explore supported attachments directly in Archive or Gallery. App communication and support replies remain alongside the rest of your private inbox. As Signal becomes part of your routine, useful context can stay connected without repeated copying between unrelated tools. Every account connection, draft change, and send action remains explicit.`,
  },
  {
    id: 'travel-overview', folderId: 'travel', name: 'What Compass Is',
    content: `Compass is the travel workspace inside Vorinthex AI. It gives countries, cities, saved places, research, trips, and travel ideas a focused home.

You can explore destinations, track places you want to visit, record places already visited, and arrange destinations inside a trip. Supporting Archive folders and Gallery collections can remain attached nearby.

Compass covers the journey from early curiosity to an organized plan while keeping travel connected to the wider workspace. Authorized places and trips can appear in Core search, then open in Compass. You decide how destinations are saved, ordered, described, and connected.`,
  },
  {
    id: 'travel-purpose', folderId: 'travel', name: 'Why We Built Compass',
    content: `We built Compass because travel planning is often fragmented across services, search tabs, saved links, screenshots, notes, and maps. Each tool handles one piece, leaving the person to reconnect everything.

Compass provides a focused structure for destinations, saved places, and trips. Archive documents and Gallery collections can stay linked to the journey rather than becoming detached references.

The future of apps is not another isolated travel destination. It is a connected workspace where travel can remain close to relevant knowledge and images. Compass reduces repeated context gathering while preserving direct control over every place, trip, attachment, and status.`,
  },
  {
    id: 'travel-start', folderId: 'travel', name: 'Your First Steps in Compass',
    content: `Begin with a country or city that interests you. Explore available destination information and save a place when you want to return to it later.

Create a trip when several destinations belong to one journey. Add places in a useful order, then attach relevant Archive folders or Gallery collections when supporting material matters.

You do not need a complete itinerary before starting. Compass can begin as a space for curiosity and gradually become a structured trip. Core search may help you locate authorized travel context, while all planning choices and changes remain in Compass under your control.`,
  },
  {
    id: 'learning-overview', folderId: 'learning', name: 'What Ascend Is',
    content: `Ascend is the learning workspace inside Vorinthex AI. It creates personalized audio books around a subject, goal, level of knowledge, and chosen listening preferences.

You can begin with an idea or select Archive documents as source material. Ascend keeps the resulting title, chapters, narration, cover, and listening progress together.

This creates a direct connection between knowledge you collect and the way you learn from it. Instead of leaving useful material unread, you can start a guided listening project that remains part of the wider workspace. Authorized books may appear in Core search and open directly in Ascend.`,
  },
  {
    id: 'learning-purpose', folderId: 'learning', name: 'Why We Built Ascend',
    content: `We built Ascend because personalized learning often requires separate services for source gathering, writing, narration, and listening. Generic material may not reflect a specific goal or chosen sources.

Ascend combines those stages in one guided audio book experience. Knowledge gathered in Archive can provide a trusted foundation, while chapters, narration, and progress remain together.

Ascend demonstrates the future of apps: information can move naturally from storage into a learning format without repeated exports or subscriptions. You choose the topic, goal, sources, voice, tone, and pace, then retain control over generation, playback, continuation, and deletion.`,
  },
  {
    id: 'learning-start', folderId: 'learning', name: 'Your First Steps in Ascend',
    content: `Choose something you genuinely want to understand, then decide what the finished audio book should help you know or do. Begin with a clear topic and learning goal.

Describe your current knowledge, select a writing tone and narrator, and choose a comfortable pace. Add Archive documents when you want the book grounded in trusted source material.

Review the brief before starting generation. Ascend builds the book in the background and keeps its chapters together for reading and listening. A useful first project could be an introduction to Vorinthex AI using the documents in this guide tree as sources.`,
  },
] as const;
export const INITIAL_WORKSPACE_DOCUMENTS: readonly GuideDocument[] = documentDefinitions.map((item) => ({ ...item, introducedInVersion: item.folderId === 'communication' ? 7 : 3 }));

export function initialWorkspaceBookRecords(scopeKey: string, timestamp: string) {
  const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
  const bookKey = initialWorkspaceBookKey(scopeKey);
  const guides = INITIAL_AUDIOBOOK_CHAPTER_GUIDE_IDS.map((id) => {
    const guide = INITIAL_WORKSPACE_DOCUMENTS.find((item) => item.id === id);
    if (!guide) throw new Error(`Initial audio book guide ${id} was not found.`);
    return guide;
  });
  const totalAudioSeconds = INITIAL_AUDIOBOOK_ASSET_MANIFEST.chapters.reduce((sum, chapter) => sum + chapter.durationSeconds, 0);
  const book = bookSchema.parse({
    key: bookKey,
    scopeKey,
    title: 'Vorinthex AI',
    subtitle: 'Six Apps, One Connected Workspace',
    description: 'A concise introduction to Core, Archive, Gallery, Signal, Compass, and Ascend.',
    summary: 'Learn how the six apps in Vorinthex AI work together while retaining clear responsibilities.',
    goal: 'Understand the purpose of every app in Vorinthex AI.',
    audience: 'Anyone getting started with Vorinthex AI.',
    outcome: 'Know where each kind of work belongs and how the apps connect.',
    language: 'English',
    generationStage: 'complete',
    generationCompletedUnits: 6,
    generationTotalUnits: 6,
    generationAttempt: 0,
    estimatedMinutes: Math.ceil(totalAudioSeconds / 60),
    chapterCount: guides.length,
    status: 'ready',
    embedding,
    isFavorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const bookChapters = guides.map((guide, index) => bookChapterSchema.parse({
    key: initialWorkspaceBookChapterKey(scopeKey, guide.id),
    scopeKey,
    bookKey,
    title: guide.name,
    description: `A concise introduction to ${guide.name.replace(/^What | Is$/g, '').trim()}.`,
    objective: `Understand ${guide.name.replace(/^What | Is$/g, '').trim()} and its role in Vorinthex AI.`,
    topics: [guide.name, 'Vorinthex AI'],
    evidenceKeyPoints: ['Use the canonical overview guide as the complete chapter source.'],
    priorTransition: index === 0 ? 'Begin with the conversational center.' : `Continue from ${guides[index - 1]!.name}.`,
    nextTransition: index + 1 === guides.length ? 'Complete the connected workspace overview.' : `Continue to ${guides[index + 1]!.name}.`,
    repetitionBoundaries: ['Use only the canonical guide text without additions.'],
    targetWordMin: BOOK_CHAPTER_WORD_MIN,
    targetWordMax: BOOK_CHAPTER_WORD_MAX,
    content: guide.content,
    status: 'audio-ready',
    position: index + 1,
    estimatedMinutes: 1,
    audioStorageKey: INITIAL_AUDIOBOOK_ASSET_MANIFEST.chapters[index]!.storageKey,
    audioDurationSeconds: INITIAL_AUDIOBOOK_ASSET_MANIFEST.chapters[index]!.durationSeconds,
    embedding,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  return { book, bookChapters };
}

const contentVersionSchema = z.number().int().nonnegative();
type InitialWorkspaceContentDependencies = {
  repository?: InitialWorkspaceContentRepository;
  embed?: (input: { texts: string[] }) => Promise<number[][]>;
  now?: () => Date;
};

export function createInitialWorkspaceContentService(dependencies: InitialWorkspaceContentDependencies = {}) {
  const repository = dependencies.repository ?? initialWorkspaceContentRepository;
  const embed = dependencies.embed ?? embedTexts;
  const now = dependencies.now ?? (() => new Date());
  return {
    async ensure(scopeKey: string) {
      const parsedScopeKey = z.string().cuid().parse(scopeKey);
      const version = contentVersionSchema.parse(INITIAL_WORKSPACE_CONTENT_VERSION);
      const previousVersion = contentVersionSchema.parse(await repository.currentVersion(parsedScopeKey));
      if (previousVersion >= version) return false;
      const timestamp = now().toISOString();
      const folderDefinitions = INITIAL_WORKSPACE_FOLDERS.filter((item) => item.introducedInVersion > previousVersion);
      const documentDefinitions = INITIAL_WORKSPACE_DOCUMENTS.filter((item) => item.introducedInVersion > previousVersion);
      const folderKeys = new Map(INITIAL_WORKSPACE_FOLDERS.map((item) => [item.id, initialWorkspaceFolderKey(parsedScopeKey, item.id)]));
      const documentDrafts = documentDefinitions.map((item) => {
        const content = sanitizeDocumentContent(item.content);
        const chunks = chunkDocumentContent(content);
        return { ...item, content, chunks, embeddingTexts: documentEmbeddingTexts(item.name, chunks) };
      });
      const folderTexts = folderDefinitions.map((item) => `${item.name}\n\n${item.description}`);
      const texts = [...folderTexts, ...documentDrafts.flatMap((item) => item.embeddingTexts)];
      const embeddings = texts.length ? await embed({ texts }) : [];
      if (embeddings.length !== texts.length) throw new Error('Initial workspace content embedding count did not match its source text.');
      const folders = folderDefinitions.map((item, index) => ({ introducedInVersion: item.introducedInVersion, value: folderSchema.parse({
        key: folderKeys.get(item.id), scopeKey: parsedScopeKey, ...(item.parentId ? { parentFolderKey: folderKeys.get(item.parentId) } : {}), name: item.name,
         description: item.description, presentation: item.presentation, embedding: embeddings[index], mutationPolicy: 'system-container', isFavorite: false, createdAt: timestamp, updatedAt: timestamp,
      }) }));
      let offset = folderTexts.length;
      const documents = documentDrafts.map((item) => {
        const chunkEmbeddings = embeddings.slice(offset, offset + item.chunks.length);
        offset += item.chunks.length;
        return { introducedInVersion: item.introducedInVersion, value: documentSchema.parse({
          key: initialWorkspaceDocumentKey(parsedScopeKey, item.id), scopeKey: parsedScopeKey, folderKey: folderKeys.get(item.folderId), name: item.name,
           extension: 'txt', mimeType: 'text/plain', content: item.content, embedding: chunkEmbeddings[0], contentChunks: item.chunks, chunkEmbeddings, semanticChunkCount: item.chunks.length,
           semanticContentHash: documentSemanticHash(item.content), mutationPolicy: 'system-only', archiveVisibility: 'visible', isFavorite: false, createdAt: timestamp, updatedAt: timestamp,
        }) };
      });
       const initialBook = initialWorkspaceBookRecords(parsedScopeKey, timestamp);
       const books = previousVersion < 6 ? [{ introducedInVersion: 6, value: initialBook.book }] : [];
       const bookChapters = previousVersion < 4 ? initialBook.bookChapters.map((value) => ({ introducedInVersion: 4, value })) : [];
       return repository.publish({ scopeKey: parsedScopeKey, version, folders, documents, books, bookChapters });
    },
  };
}

export const initialWorkspaceContentService = createInitialWorkspaceContentService();
