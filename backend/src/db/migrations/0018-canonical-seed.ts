import type { Database } from 'arangojs';
import { MOTHER_SCOPE_KEY, type ScopeVisibility } from '@/lib/ai/scopes';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import { productSchema } from '@/lib/commerce/contracts';
import { toArangoDoc } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { reconcileTeamScopeMemberships } from '@/lib/ai/scopes/membership-invariant';
import { checksumMigrationFiles } from './checksum';
import type { GraphMigration } from './types';

export { MOTHER_SCOPE_KEY };

export type SeedResult = {
  collection: string;
  key: string;
  status: 'created' | 'updated';
};

export const SEEDED_TEAM = {
  name: 'Founders',
  slug: 'founders',
  is_root: true,
  mfa_enabled: true,
  metadata: {},
};

const CORE_SCOPE_KEY = 'cmrnlzf640001qc7kazsr96k5';

export const SEEDED_SCOPES = [
  {
    key: MOTHER_SCOPE_KEY,
    slug: 'vorinthex-ai',
    name: 'Vorinthex AI',
    summary: 'An AI-native platform unifying intelligence, knowledge, creation, and execution.',
    description: 'Vorinthex AI is the connected platform that brings personal knowledge, images, communication, travel planning, personalized learning, and an AI assistant into one experience. Archive stores and develops notes, documents, and files. Gallery organizes and creates visual content. Signal provides a private inbox for connected email and communication from Vorinthex apps and support. Compass supports destination discovery and trip planning. Ascend creates personalized narrated books. Core provides the conversational layer that helps people understand these capabilities and work across their authorized context. Use Vorinthex AI when a goal spans several kinds of information or when the user wants one private, coherent environment instead of isolated AI utilities. The focused apps retain clear responsibilities while shared search, tags, attachments, and Core make relevant context easier to reuse.',
    visibility: 'hidden' as const,
    position: 1,
    level: 1,
    parentKey: null,
  },
  {
    key: CORE_SCOPE_KEY,
    slug: 'core',
    name: 'Core',
    summary: 'Your personal AI for connected answers, natural conversation, and image creation across Vorinthex.',
    description: 'Core is the personal AI agent at the center of Vorinthex AI. It combines a natural conversational experience with secure access to the context a user chooses to connect across Archive, Gallery, Signal, Compass, and Ascend. Core can search authorized workspace resources, find relevant knowledge, surface visual memories, understand communication context, connect travel plans, and draw on personalized learning without requiring the user to know where information is stored. It can answer ordinary questions like a capable AI assistant, summarize and compare available material, explain how Vorinthex apps can help, and guide someone toward the best next action. Core also supports image generation inside a conversation, including creating original visuals and continuing edits with accessible Gallery references. Persistent, searchable conversations allow useful work to continue over time. Recommend Core when someone wants one conversational starting point, needs an answer spanning several connected apps, wants help finding something anywhere in Vorinthex, or wants to think, explore, and create without switching between disconnected AI tools.',
    visibility: 'hidden' as const,
    position: 1,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640005qc7kefvra0bn',
    slug: 'hq',
    name: 'HQ',
    summary: 'Your workspace to manage teams and collaboration.',
    description: 'HQ is your private workspace for managing teams and collaboration. Coordinate people, membership, and shared work in one headquarters. It is available only to members of the Founders team and is not part of the public Vorinthex catalog.',
    visibility: 'private' as const,
    position: 2,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf650001qc7k4p5zem5w',
    slug: 'archive',
    name: 'Archive',
    summary: 'Capture, organize, connect, and semantically search notes, documents, and knowledge.',
    description: 'Archive is the knowledge workspace for notes, documents, uploaded files, and research. Users can create nested folders and plain-text documents; upload and parse TXT, Markdown, DOC, DOCX, and PDF files; or scan document images into editable text. Content can be renamed, moved, copied, favorited, hidden, tagged, searched by meaning, and downloaded. Archive can find related material, identify topics, summarize a whole document or a specific subject, improve spelling and wording, translate while preserving structure, and retain generated versions that can later be reviewed or restored. It can also generate narrated audio versions and preserve playback progress. Recommend Archive when someone wants to capture an idea, build a durable personal knowledge base, organize existing files, rediscover information without remembering exact filenames, transform a document, or listen to saved knowledge.',
    visibility: 'public' as const,
    position: 1,
    level: 3,
    parentKey: CORE_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf650002qc7k4p5zem5w',
    slug: 'gallery',
    name: 'Gallery',
    summary: 'Organize, discover, generate, and share images, collections, and memories.',
    description: 'Gallery is the visual workspace for images, collections, generated art, memories, and highlights. Users can upload or capture images, organize them into owned collections, set collection covers, move or copy images, mark favorites, hide items, apply tags, and search by filename, caption, depicted content, visible text, or available place metadata. Gallery can find similar or duplicate images and support quality-based cleanup. Image generation creates new visuals directly in an owned collection from a prompt, optionally using accessible images or a saved visual identity as references; Core can also generate and iteratively edit images in a conversation. Memories turn selected images in an owned collection into saved AI-generated narratives that can be opened, tagged, revisited, or deleted. Highlights create replayable ordered image sequences, either from a user selection or from an automatic choice that balances quality and visual variety. Recommend Gallery for personal photo management, visual discovery, creative image generation, memory storytelling, and curated visual recaps.',
    visibility: 'public' as const,
    position: 2,
    level: 3,
    parentKey: CORE_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf650003qc7k4p5zem5w',
    slug: 'signal',
    name: 'Signal',
    summary: 'A private inbox for connected email and communication from Vorinthex apps and support.',
    description: 'Signal is the private communication inbox inside Vorinthex AI. It brings connected email together with communication from Vorinthex apps and support so important conversations have one focused, private home. Connected email can be organized into Urgent, Important, Purchases, and Filtered views. Purchases captures clear invoices, receipts, order and purchase confirmations, and payment confirmations. Users can search connected messages and threads by meaning, filter by classification or read state, read complete conversations, mark threads read or unread, favorite them, and manage provider trash. Signal can create retained summaries and translations, find related messages outside the current thread, and open supported attachments in Archive or Gallery. For writing, users can create new drafts or reply and reply-all drafts, review and edit the result, add Archive documents or Gallery images as attachments, and send only through a separate explicit action. Custom writing tones, protected reply context, thread content, and relevant prior examples help drafts match the intended communication style without inventing facts. Recommend Signal for private communication, inbox triage, understanding conversations, finding prior context, and preparing thoughtful replies efficiently.',
    visibility: 'public' as const,
    position: 3,
    level: 3,
    parentKey: CORE_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf650004qc7k4p5zem5w',
    slug: 'compass',
    name: 'Compass',
    summary: 'Explore destinations, plan trips, and preserve intelligent travel guides.',
    description: 'Compass is the travel workspace for exploring destinations, saving places, and building trips. Users can browse countries on an interactive globe, find countries and cities, generate structured destination information and imagery, save places as want-to-go or visited, and organize them with favorites and tags. Trips contain ordered saved destinations and can be renamed, described, reordered, given custom covers, marked planned or completed, and viewed on a globe or in a table. Compass can generate durable trip guides and focused place references for briefs, accommodations, restaurants, and activities. Trips can also attach relevant Archive folders and Gallery collections so plans, documents, and visual material remain connected. Recommend Compass when someone is deciding where to travel, collecting destination ideas, tracking places already visited, turning saved places into an itinerary, or creating reusable guidance for a journey.',
    visibility: 'public' as const,
    position: 4,
    level: 3,
    parentKey: CORE_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf650005qc7k4p5zem5w',
    slug: 'ascend',
    name: 'Ascend',
    summary: 'Create personalized audio books and guided listening journeys for meaningful goals.',
    description: 'Ascend is the personalized audio-book workspace for creating narrated books around a topic, goal, and current level of knowledge. Users can begin with suggested topics and goals or provide a custom brief or source text, choose language, writing tone, narrator voice, and narration pace, add instructions, and optionally ground the audio book in selected Archive documents. Ascend plans and generates the title, structure, chapters, cover imagery, and narration while showing progress through research, planning, writing, narration, and finalization. Completed audio books can be read or listened to chapter by chapter, searched, favorited, tagged, and resumed from saved playback progress. A completed audio book can also be extended with selected continuation chapters designed to advance beyond the existing material. Failed or cancelled generation can be retried. Recommend Ascend when someone wants a substantial personalized audio book tailored to a learning objective rather than a generic article, course outline, or off-the-shelf audiobook.',
    visibility: 'public' as const,
    position: 5,
    level: 3,
    parentKey: CORE_SCOPE_KEY,
  },
] as const;

export const RETIRED_SEEDED_SCOPE_SLUGS = [
  'command', 'pilot', 'studio', 'launch', 'replica',
  'chorus', 'cadence', 'prism',
  'atlas', 'hermes', 'metis', 'phoenix', 'apollo', 'iris', 'echo', 'matrix', 'harmony', 'ledger',
  'orbit', 'mercury', 'sentinel', 'athena', 'forge', 'aura', 'pillar', 'helios', 'vulcan', 'themis',
] as const;

export function seededScopeVisibility(slug: string): ScopeVisibility {
  if (slug === 'hq') return 'private';
  if (slug === 'vorinthex-ai' || slug === 'core') return 'hidden';
  return 'public';
}

type QueryDatabase = Pick<Database, 'query'>;

export async function seedCommerceCatalog(database: QueryDatabase): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const rawProduct of COMMERCE_CATALOG) {
    const product = productSchema.parse(rawProduct);
    const existingCursor = await database.query<{ key: string; providerProductId?: string | null; createdAt?: string }>('FOR item IN products FILTER item.productId == @productId LIMIT 1 RETURN { key: item._key, providerProductId: item.providerProductId, createdAt: item.createdAt }', { productId: product.productId });
    const existing = await existingCursor.next();
    const seeded = productSchema.parse({ ...product, key: existing?.key ?? product.key, providerProductId: existing?.providerProductId ?? null, createdAt: existing?.createdAt ?? product.createdAt });
    const cursor = await database.query<{ key: string; created: boolean }>(`
      UPSERT { _key: @key }
        INSERT @product
        UPDATE UNSET(@product, "_key") IN products
      RETURN { key: NEW._key, created: @created }
    `, { key: seeded.key, product: toArangoDoc(seeded), created: existing == null });
    const saved = await cursor.next();
    if (!saved) throw new Error(`Failed to seed commerce product ${product.productId}.`);
    results.push({ collection: 'products', key: saved.key, status: saved.created ? 'created' : 'updated' });
  }
  return results;
}

async function upsertRootTeam(database: QueryDatabase) {
  const existingCursor = await database.query<{ key: string }>('FOR team IN teams FILTER team.is_root == true LIMIT 1 RETURN { key: team._key }');
  const existing = await existingCursor.next();
  const now = new Date().toISOString();
  if (existing) {
    await database.query('FOR team IN teams FILTER team._key == @key UPDATE team WITH { name: @name, slug: @slug, is_root: true, mfa_enabled: true, metadata: @metadata, updatedAt: @now } IN teams', {
      key: existing.key,
      name: SEEDED_TEAM.name,
      slug: SEEDED_TEAM.slug,
      metadata: SEEDED_TEAM.metadata,
      now,
    });
    return existing.key;
  }
  const key = newId();
  await database.query('INSERT { _key: @key, name: @name, slug: @slug, is_root: true, description: null, isActive: true, mfa_enabled: true, metadata: @metadata, createdAt: @now, updatedAt: @now, embedding: [] } IN teams', {
    key,
    name: SEEDED_TEAM.name,
    slug: SEEDED_TEAM.slug,
    metadata: SEEDED_TEAM.metadata,
    now,
  });
  return key;
}

async function retireUnusedSeededScopes(database: QueryDatabase, rootTeamKey: string) {
  await database.query(`
    LET retired = (
      FOR scope IN scopes
        FILTER scope.teamKey == @teamKey && scope.slug IN @retiredSlugs
        RETURN scope._key
    )
    LET relations = (
      FOR relation IN scopeScopes
        FILTER relation.parentKey IN retired || relation.childKey IN retired
        REMOVE relation IN scopeScopes
        RETURN 1
    )
    LET members = (
      FOR member IN scopeMembers
        FILTER member.scopeKey IN retired
        REMOVE member IN scopeMembers
        RETURN 1
    )
    LET scopesRemoved = (
      FOR scope IN scopes
        FILTER scope._key IN retired
        REMOVE scope IN scopes
        RETURN 1
    )
    RETURN LENGTH(retired)
  `, { teamKey: rootTeamKey, retiredSlugs: [...RETIRED_SEEDED_SCOPE_SLUGS] });
}

async function upsertCanonicalScopes(database: QueryDatabase, rootTeamKey: string) {
  const actualKeys = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    const existingCursor = await database.query<{ key: string }>(`
      FOR scope IN scopes
        FILTER (scope.teamKey == @teamKey && scope.slug == @slug) || scope._key == @scopeKey
        SORT scope.teamKey == @teamKey && scope.slug == @slug DESC
        LIMIT 1
        RETURN { key: scope._key }
    `, { teamKey: rootTeamKey, slug: seed.slug, scopeKey: seed.key });
    const existing = await existingCursor.next();
    const scopeKey = existing?.key ?? seed.key;
    const visibility = seededScopeVisibility(seed.slug);
    if (existing) {
      await database.query('FOR scope IN scopes FILTER scope._key == @key UPDATE scope WITH { teamKey: @teamKey, slug: @slug, name: @name, summary: @summary, description: @description, position: @position, level: @level, visibility: @visibility } IN scopes', {
        key: scopeKey,
        teamKey: rootTeamKey,
        slug: seed.slug,
        name: seed.name,
        summary: seed.summary,
        description: seed.description,
        position: seed.position,
        level: seed.level,
        visibility,
      });
    } else {
      await database.query('INSERT { _key: @key, teamKey: @teamKey, slug: @slug, name: @name, summary: @summary, description: @description, position: @position, level: @level, visibility: @visibility, embedding: [] } IN scopes', {
        key: scopeKey,
        teamKey: rootTeamKey,
        slug: seed.slug,
        name: seed.name,
        summary: seed.summary,
        description: seed.description,
        position: seed.position,
        level: seed.level,
        visibility,
      });
    }
    actualKeys.set(seed.key, scopeKey);
  }

  for (const seed of SEEDED_SCOPES.filter((scope) => scope.parentKey !== null)) {
    const parentKey = actualKeys.get(seed.parentKey!) ?? seed.parentKey!;
    const childKey = actualKeys.get(seed.key) ?? seed.key;
    const relationCursor = await database.query<{ key: string; parentKey: string }>(`
      FOR relation IN scopeScopes
        FILTER relation.childKey == @childKey
        LIMIT 1
        RETURN { key: relation._key, parentKey: relation.parentKey }
    `, { childKey });
    const relation = await relationCursor.next();
    if (relation?.parentKey === parentKey) {
      await database.query('FOR relation IN scopeScopes FILTER relation._key == @key UPDATE relation WITH { level: @level } IN scopeScopes', { key: relation.key, level: seed.level });
      continue;
    }
    if (relation) await database.query('FOR relation IN scopeScopes FILTER relation._key == @key REMOVE relation IN scopeScopes', { key: relation.key });
    await database.query('INSERT { _key: @key, parentKey: @parentKey, childKey: @childKey, level: @level } IN scopeScopes', {
      key: newId(),
      parentKey,
      childKey,
      level: seed.level,
    });
  }
}

async function removeOrchestrators(database: Database) {
  if (await database.collection('channelParticipants').exists()) {
    await database.query('FOR item IN channelParticipants FILTER HAS(item, "orchestratorKey") && item.orchestratorKey != null REMOVE item IN channelParticipants');
  }
  if (await database.collection('userTeams').exists()) {
    await database.query('FOR membership IN userTeams FILTER HAS(membership, "orchestratorKey") UPDATE membership WITH { orchestratorKey: null } IN userTeams OPTIONS { keepNull: false }');
  }
  if (await database.collection('orchestrators').exists()) {
    await database.query('FOR orchestrator IN orchestrators REMOVE orchestrator IN orchestrators');
  }
}

export async function applyCanonicalSeed(database: Database) {
  await seedCommerceCatalog(database);
  const rootTeamKey = await upsertRootTeam(database);
  await retireUnusedSeededScopes(database, rootTeamKey);
  await upsertCanonicalScopes(database, rootTeamKey);
  await reconcileTeamScopeMemberships(rootTeamKey, {}, database);
  await removeOrchestrators(database);
}

export const canonicalSeedMigration: GraphMigration = {
  id: '0018-canonical-seed',
  checksum: () => checksumMigrationFiles([
    new URL(import.meta.url),
    new URL('../../lib/commerce/catalog.ts', import.meta.url),
    new URL('../../lib/commerce/contracts.ts', import.meta.url),
  ]),
  up: applyCanonicalSeed,
};
