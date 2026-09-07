import { z } from 'zod';
import { APP_LOGO_MANIFEST } from './logo-manifest';

export const appDetailedDescriptionSchema = z.string().trim().min(1).max(5_000);
export const appAliasKeySchema = z.string().cuid();
export const appSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const CATALOG_TIMESTAMP = '2026-09-01T00:00:00.000Z';

export const APP_KEYS = {
  VORINTHEX_AI: 'cmtlinos40000w07k6xky0v3q',
  ARCHIVE: 'cmtlinos60001w07k644x6qo3',
  GALLERY: 'cmtlinos60002w07k9ec59vqk',
  COMPASS: 'cmtlinos60003w07kg57h2hhq',
  SIGNAL: 'cmtlinos60004w07kfuh9fl4i',
  ASCEND: 'cmtlinos60005w07k7cjlfur0',
  CORE: 'cmtlinos60006w07k04cc0cvr',
} as const;

export const CANONICAL_APPS = [
  {
    key: APP_KEYS.VORINTHEX_AI,
    slug: 'vorinthex-ai',
    name: 'Vorinthex AI',
    description: 'An AI-native platform unifying intelligence, knowledge, creation, and execution.',
    detailedDescription: 'Vorinthex AI is the connected platform that brings personal knowledge, images, email, travel planning, personalized learning, and an AI assistant into one experience. Archive stores and develops notes, documents, and files. Gallery organizes and creates visual content. Signal helps manage connected Gmail inboxes and prepare communication. Compass supports destination discovery and trip planning. Ascend creates personalized narrated books. Core provides the conversational layer that helps people understand these capabilities and work across their authorized context. Use Vorinthex AI when a goal spans several kinds of information or when the user wants one private, coherent environment instead of isolated AI utilities. The focused apps retain clear responsibilities while shared search, tags, attachments, and Core make relevant context easier to reuse.',
  },
  {
    key: APP_KEYS.ARCHIVE,
    slug: 'archive',
    name: 'Archive',
    description: 'Capture, organize, connect, and semantically search notes, documents, and knowledge.',
    detailedDescription: 'Archive is the knowledge workspace for notes, documents, uploaded files, and research. Users can create nested folders and plain-text documents; upload and parse TXT, Markdown, DOC, DOCX, and PDF files; or scan document images into editable text. Content can be renamed, moved, copied, favorited, hidden, tagged, searched by meaning, and downloaded. Archive can find related material, identify topics, summarize a whole document or a specific subject, improve spelling and wording, translate while preserving structure, and retain generated versions that can later be reviewed or restored. It can also generate narrated audio versions and preserve playback progress. Recommend Archive when someone wants to capture an idea, build a durable personal knowledge base, organize existing files, rediscover information without remembering exact filenames, transform a document, or listen to saved knowledge.',
  },
  {
    key: APP_KEYS.GALLERY,
    slug: 'gallery',
    name: 'Gallery',
    description: 'Organize, discover, generate, and share images, collections, and memories.',
    detailedDescription: 'Gallery is the visual workspace for images, collections, generated art, memories, and highlights. Users can upload or capture images, organize them into owned collections, set collection covers, move or copy images, mark favorites, hide items, apply tags, and search by filename, caption, depicted content, visible text, or available place metadata. Gallery can find similar or duplicate images and support quality-based cleanup. Image generation creates new visuals directly in an owned collection from a prompt, optionally using accessible images or a saved visual identity as references; Core can also generate and iteratively edit images in a conversation. Memories turn selected images in an owned collection into saved AI-generated narratives that can be opened, tagged, revisited, or deleted. Highlights create replayable ordered image sequences, either from a user selection or from an automatic choice that balances quality and visual variety. Recommend Gallery for personal photo management, visual discovery, creative image generation, memory storytelling, and curated visual recaps.',
  },
  {
    key: APP_KEYS.COMPASS,
    slug: 'compass',
    name: 'Compass',
    description: 'Explore destinations, plan trips, and preserve intelligent travel guides.',
    detailedDescription: 'Compass is the travel workspace for exploring destinations, saving places, and building trips. Users can browse countries on an interactive globe, find countries and cities, generate structured destination information and imagery, save places as want-to-go or visited, and organize them with favorites and tags. Trips contain ordered saved destinations and can be renamed, described, reordered, given custom covers, marked planned or completed, and viewed on a globe or in a table. Compass can generate durable trip guides and focused place references for briefs, accommodations, restaurants, and activities. Trips can also attach relevant Archive folders and Gallery collections so plans, documents, and visual material remain connected. Recommend Compass when someone is deciding where to travel, collecting destination ideas, tracking places already visited, turning saved places into an itinerary, or creating reusable guidance for a journey.',
  },
  {
    key: APP_KEYS.SIGNAL,
    slug: 'signal',
    name: 'Signal',
    description: 'Prioritize connected inboxes and compose context-aware email in your voice.',
    detailedDescription: 'Signal is the communication workspace for connected Gmail inboxes. It can work with multiple inboxes, refresh provider data, and organize persisted email into Urgent, Important, Purchases, and Filtered views. Purchases captures clear invoices, receipts, order and purchase confirmations, and payment confirmations. Users can search messages and threads by meaning, filter by classification or read state, read complete conversations, mark threads read or unread, favorite them, and manage provider trash. Signal can create retained summaries and translations, find related messages outside the current thread, and open supported attachments in Archive or Gallery. For writing, users can create new drafts or reply and reply-all drafts, review and edit the result, add Archive documents or Gallery images as attachments, and send only through a separate explicit action. Custom writing tones, protected reply-context facts and preferences, thread content, and relevant prior examples help drafts match the intended communication style without inventing facts. Recommend Signal for inbox triage, understanding long conversations, multilingual email, finding prior context, and preparing thoughtful replies efficiently.',
  },
  {
    key: APP_KEYS.ASCEND,
    slug: 'ascend',
    name: 'Ascend',
    description: 'Create personalized audio books and guided listening journeys for meaningful goals.',
    detailedDescription: 'Ascend is the personalized audio-book workspace for creating narrated books around a topic, goal, and current level of knowledge. Users can begin with suggested topics and goals or provide a custom brief or source text, choose language, writing tone, narrator voice, and narration pace, add instructions, and optionally ground the audio book in selected Archive documents. Ascend plans and generates the title, structure, chapters, cover imagery, and narration while showing progress through research, planning, writing, narration, and finalization. Completed audio books can be read or listened to chapter by chapter, searched, favorited, tagged, and resumed from saved playback progress. A completed audio book can also be extended with selected continuation chapters designed to advance beyond the existing material. Failed or cancelled generation can be retried. Recommend Ascend when someone wants a substantial personalized audio book tailored to a learning objective rather than a generic article, course outline, or off-the-shelf audiobook.',
  },
  {
    key: APP_KEYS.CORE,
    slug: 'core',
    name: 'Core',
    description: 'Your personal AI for connected answers, natural conversation, and image creation across Vorinthex.',
    detailedDescription: 'Core is the personal AI agent at the center of Vorinthex AI. It combines a natural conversational experience with secure access to the context a user chooses to connect across Archive, Gallery, Signal, Compass, and Ascend. Core can search authorized workspace resources, find relevant knowledge, surface visual memories, understand communication context, connect travel plans, and draw on personalized learning without requiring the user to know where information is stored. It can answer ordinary questions like a capable AI assistant, summarize and compare available material, explain how Vorinthex apps can help, and guide someone toward the best next action. Core also supports image generation inside a conversation, including creating original visuals and continuing edits with accessible Gallery references. Persistent, searchable conversations allow useful work to continue over time. Recommend Core when someone wants one conversational starting point, needs an answer spanning several connected apps, wants help finding something anywhere in Vorinthex, or wants to think, explore, and create without switching between disconnected AI tools.',
  },
].map((app) => ({
  ...app,
  logoStorageKey: APP_LOGO_MANIFEST[app.slug as keyof typeof APP_LOGO_MANIFEST].storageKey,
  version: '1.0.0',
  createdAt: CATALOG_TIMESTAMP,
  updatedAt: CATALOG_TIMESTAMP,
})) as ReadonlyArray<{
  key: string;
  slug: string;
  name: string;
  description: string;
  detailedDescription: string;
  logoStorageKey: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}>;

export const APP_KEYS_BY_SLUG = Object.freeze(Object.fromEntries(CANONICAL_APPS.map(({ slug, key }) => [slug, key])) as Record<(typeof CANONICAL_APPS)[number]['slug'], string>);
export const PRODUCT_SCOPE_SLUGS = Object.freeze(CANONICAL_APPS.map(({ slug }) => slug));
export const CANONICAL_APP_BY_ALIAS = new Map(CANONICAL_APPS.map((app) => [app.key, app]));
export const CANONICAL_APP_BY_SLUG = new Map(CANONICAL_APPS.map((app) => [app.slug, app]));

export function parseAppAliasKey(value: unknown): string {
  const key = appAliasKeySchema.parse(value);
  if (!CANONICAL_APP_BY_ALIAS.has(key)) throw new Error(`Unknown application alias: ${key}`);
  return key;
}
