import { aql } from 'arangojs';
import { closeDb, db } from './client';
import { newId } from '@/lib/ids';
import { getRootTeam, insertTeam, updateTeam, type Team } from './teams.node';
import { getUserTeamByTeamAndUser, updateUserTeam } from './user-team.node';
import { getUserByEmail } from './users.node';
import { getOrchestratorByName, insertOrchestrator, updateOrchestrator, type Orchestrator } from './orchestrators.node';
import { createScopeRepository, MOTHER_SCOPE_KEY } from '@/lib/ai/scopes';
import { reconcileTeamScopeMemberships } from '@/lib/ai/scopes/membership-invariant';
import { SEEDED_ORCHESTRATOR_SKILLS } from '@/lib/orchestrators/seeded-skills';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import { COUNTRY_CATALOG } from '@/lib/travel/country-catalog';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isProviderError } from '@/lib/ai/providers/errors';
import { CANONICAL_APP_BY_SLUG, CANONICAL_APPS } from '@/lib/apps/registry';
import { toArangoDoc } from './base';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import { productSchema } from '@/lib/commerce/contracts';
import { managedScopeDirectoryProduct, reconcileManagedScopeDirectory, type ManagedScopeDirectoryTargets } from '@/lib/managed-scope-directory';

export type SeedResult = {
  collection: string;
  key: string;
  status: 'created' | 'updated';
};

export class SeedReferenceError extends Error {
  constructor(public readonly entity: string, public readonly reference: string, public readonly relation: string) {
    super(`Seed ${entity} not found for ${relation}: ${reference}`);
    this.name = 'SeedReferenceError';
  }
}

const now = () => new Date().toISOString();

export async function seedCommerceCatalog(database: Pick<typeof db, 'query'> = db): Promise<SeedResult[]> {
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

async function updateSemanticSeed(collection: string, key: string, update: () => Promise<unknown>): Promise<SeedResult> {
  try {
    await update();
  } catch (error) {
    if (!isProviderError(error) || !error.retryable) throw error;
    console.warn(`${collection}: semantic seed refresh deferred because ${error.providerId} is unavailable (${error.code}).`);
  }
  return { collection, key, status: 'updated' };
}

export const SEEDED_TEAM = {
  name: 'Founders',
  slug: 'founders',
  is_root: true,
  mfa_enabled: true,
  metadata: {},
};

export { MOTHER_SCOPE_KEY };

function productScopePresentation(slug: string) {
  const product = CANONICAL_APP_BY_SLUG.get(slug);
  if (!product) throw new Error(`Missing canonical product presentation for ${slug}.`);
  return { slug: product.slug, name: product.name, summary: product.description, description: product.detailedDescription };
}

export const SEEDED_SCOPES = [
  {
    key: MOTHER_SCOPE_KEY,
    ...productScopePresentation('vorinthex-ai'),
    position: 1,
    level: 1,
    parentKey: null,
  },
  {
    key: 'cmrnlzf640001qc7kazsr96k5',
    ...productScopePresentation('core'),
    position: 1,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640004qc7kdvj99uva',
    slug: 'command',
    name: 'Command',
    summary: 'A command center with 20 AI executive orchestrators, from Atlas to Vulcan, for every function of the company.',
    description: 'A command center with 20 AI executive orchestrators, led by Atlas and spanning operations, intelligence, growth, product, finance, security, and more, leading the work while you lead the vision.',
    position: 2,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640005qc7kefvra0bn',
    slug: 'hq',
    name: 'HQ',
    summary: 'The team workspace for communication, collaboration, planning, and coordinated work.',
    description: 'HQ is the shared operating space for a team. Bring conversations, plans, projects, decisions, knowledge, and coordinated work into one focused headquarters.',
    position: 3,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640007qc7kd6a2g0o8',
    slug: 'pilot',
    name: 'Pilot',
    summary: 'A learning platform for the AI era.',
    description: 'Pilot is the Vorinthex learning platform for the AI era, built to help people develop the understanding and practical fluency they need to move forward.',
    position: 4,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640003qc7k4n8zesyz',
    slug: 'studio',
    name: 'Studio',
    summary: 'A unified studio for chat, image, video, music, voice, code, documents, and research.',
    description: 'Every leading AI model in one interface, chat, image, video, music, voice, code, documents, and research in a single creative workspace.',
    position: 5,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640002qc7kfp2qelhq',
    slug: 'launch',
    name: 'Launch',
    summary: 'A lightweight platform to create agents, automations, workflows, and deploy them everywhere.',
    description: 'A lightweight platform to create agents, automations, and workflows, then deploy them everywhere your work happens.',
    position: 6,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640006qc7kfjl23jc3',
    slug: 'replica',
    name: 'Replica',
    summary: 'A sandbox for experiencing a product before you connect.',
    description: 'Replica is the Vorinthex sandbox for experiencing a product before you connect, giving you a clear place to explore what it can do first.',
    position: 7,
    level: 2,
    parentKey: MOTHER_SCOPE_KEY,
  },
  { key: 'cmrnlzf650001qc7k4p5zem5w', ...productScopePresentation('archive'), position: 1, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650002qc7k4p5zem5w', ...productScopePresentation('gallery'), position: 2, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650003qc7k4p5zem5w', ...productScopePresentation('signal'), position: 3, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650004qc7k4p5zem5w', ...productScopePresentation('compass'), position: 4, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650005qc7k4p5zem5w', ...productScopePresentation('ascend'), position: 5, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650026qc7k4p5zem5w', slug: 'chorus', name: 'Chorus', summary: 'Communication intelligence for messaging, channels, threads, and real time collaboration between people and AI.', description: 'Chorus is an AI native communication workspace for messaging, channels, threads, announcements, direct messages, and real time collaboration. It understands conversations semantically so people can search by meaning, summarize discussions, identify action items, translate messages, and recover important context without manual filing. Chorus supports reactions, mentions, attachments, presence, and persistent conversation history.', position: 6, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650027qc7k4p5zem5w', slug: 'cadence', name: 'Cadence', summary: 'Temporal intelligence for calendars, schedules, meetings, availability, reminders, and recurring events.', description: 'Cadence is an intelligent planning system for calendars, events, meetings, reminders, availability, deadlines, recurring schedules, reservations, and planning windows. It understands relationships between commitments, priorities, people, and resources, then helps resolve conflicts, suggest useful times, prepare agendas, protect focus time, and maintain clear follow through. Cadence treats time as structured information rather than a simple chronological list.', position: 7, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650029qc7k4p5zem5w', slug: 'prism', name: 'Prism', summary: 'Meeting and presence intelligence for voice, video, screen sharing, recordings, transcription, and collaborative sessions.', description: 'Prism is a real time meeting workspace for voice calls, video sessions, screen sharing, recordings, live transcription, captions, and AI assistance. It understands conversations as they happen, making discussions searchable and turning decisions, follow up items, and important context into durable knowledge. Prism preserves the full meeting experience through participants, recordings, transcripts, summaries, and collaborative session metadata.', position: 8, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650006qc7k4p5zem5w', slug: 'atlas', name: 'Atlas', summary: 'Vision, leadership, direction, executive strategy, and company wide decisions.', description: 'Vision, leadership, direction, executive strategy, and company wide decisions.', position: 1, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650007qc7k4p5zem5w', slug: 'hermes', name: 'Hermes', summary: 'Operations, execution, efficiency, systems, process, and delivery.', description: 'Operations, execution, efficiency, systems, process, and delivery.', position: 2, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650008qc7k4p5zem5w', slug: 'metis', name: 'Metis', summary: 'Intelligence, knowledge, data, documents, RAG, internal brain, and integrations.', description: 'Intelligence, knowledge, data, documents, RAG, internal brain, and integrations.', position: 3, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650009qc7k4p5zem5w', slug: 'phoenix', name: 'Phoenix', summary: 'Growth, market insight, acquisition, activation, retention, and durable commercial value.', description: 'Growth, market insight, acquisition, activation, retention, and durable commercial value.', position: 4, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650010qc7k4p5zem5w', slug: 'apollo', name: 'Apollo', summary: 'Strategy, foresight, growth, market direction, and long range planning.', description: 'Strategy, foresight, growth, market direction, and long range planning.', position: 5, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650011qc7k4p5zem5w', slug: 'iris', name: 'Iris', summary: 'Communication, brand, voice, PR, messaging, and internal and external communications.', description: 'Communication, brand, voice, PR, messaging, and internal and external communications.', position: 6, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650012qc7k4p5zem5w', slug: 'echo', name: 'Echo', summary: 'Institutional learning, expertise reuse, durable guidance, knowledge discovery, and trusted team memory.', description: 'Institutional learning, expertise reuse, durable guidance, knowledge discovery, and trusted team memory.', position: 7, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650013qc7k4p5zem5w', slug: 'matrix', name: 'Matrix', summary: 'Data governance, lineage, ownership, quality, definitions, and decision ready data assets.', description: 'Data governance, lineage, ownership, quality, definitions, and decision ready data assets.', position: 8, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650014qc7k4p5zem5w', slug: 'harmony', name: 'Harmony', summary: 'People systems, talent, culture, team structure, capability, and sustained high quality work.', description: 'People systems, talent, culture, team structure, capability, and sustained high quality work.', position: 9, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650015qc7k4p5zem5w', slug: 'ledger', name: 'Ledger', summary: 'Finance, capital, budgets, cash flow, forecasting, and financial risk.', description: 'Finance, capital, budgets, cash flow, forecasting, and financial risk.', position: 10, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650016qc7k4p5zem5w', slug: 'orbit', name: 'Orbit', summary: 'Marketing, growth, demand, branding, content, campaigns, SEO, and social.', description: 'Marketing, growth, demand, branding, content, campaigns, SEO, and social.', position: 11, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650017qc7k4p5zem5w', slug: 'mercury', name: 'Mercury', summary: 'Revenue, analytics, MRR, forecasting, sales patterns, churn, and retention.', description: 'Revenue, analytics, MRR, forecasting, sales patterns, churn, and retention.', position: 12, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650018qc7k4p5zem5w', slug: 'sentinel', name: 'Sentinel', summary: 'Security, risk, protection, compliance, privacy, and trust.', description: 'Security, risk, protection, compliance, privacy, and trust.', position: 13, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650019qc7k4p5zem5w', slug: 'athena', name: 'Athena', summary: 'Product, experience, innovation, roadmap, value, and users.', description: 'Product, experience, innovation, roadmap, value, and users.', position: 14, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650020qc7k4p5zem5w', slug: 'forge', name: 'Forge', summary: 'Technology, architecture, engineering, infrastructure, and AI.', description: 'Technology, architecture, engineering, infrastructure, and AI.', position: 15, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650021qc7k4p5zem5w', slug: 'aura', name: 'Aura', summary: 'Customer and product experience, journey coherence, friction reduction, confidence, and meaningful touchpoints.', description: 'Customer and product experience, journey coherence, friction reduction, confidence, and meaningful touchpoints.', position: 16, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650022qc7k4p5zem5w', slug: 'pillar', name: 'Pillar', summary: 'Quality systems, prevention, measurable delivery standards, early defect detection, and durable improvement.', description: 'Quality systems, prevention, measurable delivery standards, early defect detection, and durable improvement.', position: 17, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650023qc7k4p5zem5w', slug: 'helios', name: 'Helios', summary: 'Accountable AI capability, use cases, evaluation, safety, human ownership, and durable advantage.', description: 'Accountable AI capability, use cases, evaluation, safety, human ownership, and durable advantage.', position: 18, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650024qc7k4p5zem5w', slug: 'vulcan', name: 'Vulcan', summary: 'Observable, safe, maintainable automation that removes repeatable operational drag.', description: 'Observable, safe, maintainable automation that removes repeatable operational drag.', position: 19, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650025qc7k4p5zem5w', slug: 'themis', name: 'Themis', summary: 'Legal, governance, ethics, contracts, compliance, and policy.', description: 'Legal, governance, ethics, contracts, compliance, and policy.', position: 20, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
] as const;

type SeededOrchestratorSource = {
  name: string;
  role: string;
  skill: string;
};

export const SEEDED_ORCHESTRATOR_SOURCES: SeededOrchestratorSource[] = [
  ['Atlas', 'CEO'], ['Metis', 'CIO'], ['Echo', 'CKO'], ['Matrix', 'CDO'], ['Hermes', 'COO'],
  ['Harmony', 'CHRO'], ['Phoenix', 'CGO'], ['Iris', 'CCO'], ['Orbit', 'CMO'], ['Apollo', 'CSO'],
  ['Athena', 'CPO'], ['Forge', 'CTO'], ['Aura', 'CXO'], ['Pillar', 'CQO'], ['Helios', 'CAIO'],
  ['Vulcan', 'CAO'], ['Ledger', 'CFO'], ['Mercury', 'CRO'], ['Sentinel', 'CISO'], ['Themis', 'CLO'],
].map(([name, role]) => ({
  name,
  role,
  skill: SEEDED_ORCHESTRATOR_SKILLS[name as keyof typeof SEEDED_ORCHESTRATOR_SKILLS],
}));

const SEEDED_FOUNDER_ORCHESTRATORS = {
  'oscar@vorinthex.com': 'Atlas',
  'josef@vorinthex.com': 'Orbit',
  'frank@vorinthex.com': 'Mercury',
  'vincent@vorinthex.com': 'Iris',
  'anton@vorinthex.com': 'Apollo',
} as const;

async function upsertSeedTeam(seed: typeof SEEDED_TEAM): Promise<SeedResult> {
  const existing = await getRootTeam();
  if (!existing) {
    const key = newId();
    await insertTeam({
      key,
      name: seed.name,
      slug: seed.slug,
      is_root: seed.is_root,
      mfa_enabled: seed.mfa_enabled,
      metadata: seed.metadata,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'teams', key, status: 'created' };
  }
  if (existing.name === seed.name && existing.slug === seed.slug && existing.is_root === seed.is_root && existing.mfa_enabled === seed.mfa_enabled && isDeepStrictEqual(existing.metadata, seed.metadata)) return { collection: 'teams', key: existing.key, status: 'updated' };

  const patch: Partial<Omit<Team, 'key' | 'embedding'>> = {
    name: seed.name,
    slug: seed.slug,
    is_root: seed.is_root,
    mfa_enabled: seed.mfa_enabled,
    metadata: seed.metadata,
    updatedAt: now(),
  };
  return updateSemanticSeed('teams', existing.key, () => updateTeam(existing.key, patch));
}

async function upsertSeedOrchestrator(seed: (typeof SEEDED_ORCHESTRATOR_SOURCES)[number]): Promise<SeedResult> {
  const existing = await getOrchestratorByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertOrchestrator({
      key,
      name: seed.name,
      role: seed.role,
      skill: seed.skill,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'orchestrators', key, status: 'created' };
  }
  if (existing.role === seed.role && isDeepStrictEqual(existing.skill, seed.skill)) return { collection: 'orchestrators', key: existing.key, status: 'updated' };

  const patch: Partial<Omit<Orchestrator, 'key' | 'embedding'>> = {
    role: seed.role,
    skill: seed.skill,
    updatedAt: now(),
  };
  return updateSemanticSeed('orchestrators', existing.key, () => updateOrchestrator(existing.key, patch));
}

async function assignSeededFounderOrchestrators(rootTeamKey: string): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const [email, orchestratorName] of Object.entries(SEEDED_FOUNDER_ORCHESTRATORS)) {
    const [user, orchestrator] = await Promise.all([
      getUserByEmail(email),
      getOrchestratorByName(orchestratorName),
    ]);
    if (!user || !orchestrator) continue;
    const membership = await getUserTeamByTeamAndUser(rootTeamKey, user.key);
    if (!membership || membership.orchestratorKey === orchestrator.key) continue;
    await updateUserTeam(membership.key, { orchestratorKey: orchestrator.key, updatedAt: now() });
    results.push({ collection: 'userTeams', key: membership.key, status: 'updated' });
  }
  return results;
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  results.push(...await seedCommerceCatalog());
  for (const country of COUNTRY_CATALOG) {
    const semanticHash = createHash('sha256').update(country.name).digest('hex');
    const currentCursor = await db.query<{ key: string; semanticVersion?: number; semanticHash?: string }>('FOR country IN countries FILTER country.countryCode == @countryCode LIMIT 1 RETURN { key: country._key, semanticVersion: country.semanticVersion, semanticHash: country.semanticHash }', { countryCode: country.countryCode });
    const current = await currentCursor.next();
    if (current?.semanticVersion === 1 && current.semanticHash === semanticHash) {
      await db.query('UPDATE @key WITH { name: @name, latitude: @latitude, longitude: @longitude } IN countries', { key: current.key, name: country.name, latitude: country.latitude, longitude: country.longitude });
      results.push({ collection: 'countries', key: current.key, status: 'updated' });
      continue;
    }
    let embedding: number[];
    try {
      embedding = currentEmbeddingSchema.parse(await embedText({ text: country.name }));
    } catch (error) {
      if (!isProviderError(error) || !error.retryable) throw error;
      console.warn(`countries: semantic seed refresh for ${country.countryCode} deferred because ${error.providerId} is unavailable (${error.code}).`);
      continue;
    }
    const cursor = await db.query(`UPSERT { countryCode: @countryCode } INSERT @country UPDATE { name: @name, latitude: @latitude, longitude: @longitude, embedding: @embedding, semanticVersion: 1, semanticHash: @semanticHash } IN countries RETURN NEW._key`, { countryCode: country.countryCode, name: country.name, latitude: country.latitude, longitude: country.longitude, semanticHash, country: { _key: country.key, ...country, embedding, semanticVersion: 1, semanticHash }, embedding });
    results.push({ collection: 'countries', key: String(await cursor.next()), status: current ? 'updated' : 'created' });
  }

  results.push(await upsertSeedTeam(SEEDED_TEAM));
  const rootTeam = await getRootTeam();
  if (!rootTeam) throw new SeedReferenceError('team', 'root', 'core seed');
  await db.query(aql`
    LET hasHq = LENGTH((
      FOR existing IN ${db.collection('scopes')}
        FILTER existing.teamKey == ${rootTeam.key} AND existing.slug == ${'hq'}
        RETURN 1
    ))
    FOR scope IN ${db.collection('scopes')}
      FILTER scope.teamKey == ${rootTeam.key}
      FILTER scope.slug == ${'head-quarters'}
      FILTER hasHq == 0
      UPDATE scope WITH { slug: 'hq' } IN ${db.collection('scopes')}
  `);
  const scopes = createScopeRepository(db, undefined, { allowProductHierarchyMutation: true });
  const teamScopes = [...await scopes.listScopes(rootTeam.key)];
  const scopesBySlug = new Map(teamScopes.map((scope) => [scope.slug, scope]));
  const actualKeysBySeedKey = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    // Legacy scope rows can be omitted from the team listing while
    // still occupying their deterministic seed key. Reuse that row instead
    // of attempting a duplicate insert during deployment.
    let existing = scopesBySlug.get(seed.slug) ?? await scopes.getScopeByKey(seed.key);
    if (existing) {
      if (existing.slug !== seed.slug || existing.name !== seed.name || existing.summary !== seed.summary || existing.description !== seed.description || existing.position !== seed.position || existing.level !== seed.level) {
        existing = await scopes.updateScope(existing.key, { slug: seed.slug, name: seed.name, summary: seed.summary, description: seed.description, position: seed.position, level: seed.level });
        scopesBySlug.set(existing.slug, existing);
        const index = teamScopes.findIndex((scope) => scope.key === existing!.key);
        if (index >= 0) teamScopes[index] = existing;
        results.push({ collection: 'scopes', key: existing.key, status: 'updated' });
      }
      actualKeysBySeedKey.set(seed.key, existing.key);
      continue;
    }
    const scope = await scopes.createScope({
      key: seed.key,
      teamKey: rootTeam.key,
      slug: seed.slug,
      name: seed.name,
      summary: seed.summary,
      description: seed.description,
      position: seed.position,
      level: seed.level,
    });
    teamScopes.push(scope);
    scopesBySlug.set(scope.slug, scope);
    actualKeysBySeedKey.set(seed.key, scope.key);
    results.push({ collection: 'scopes', key: scope.key, status: 'created' });
  }

  const relationsByChild = new Map<string, { parentKey: string; childKey: string }>();
  for (const scope of teamScopes) {
    for (const relation of await scopes.listChildRelations(scope.key)) {
      relationsByChild.set(relation.childKey, relation);
    }
  }
  for (const seed of SEEDED_SCOPES.filter((scope) => scope.parentKey)) {
    const childKey = actualKeysBySeedKey.get(seed.key) ?? seed.key;
    const child = await scopes.getScopeByKey(childKey);
    if (!child) throw new SeedReferenceError('scope', seed.slug, 'scopeScopes');
    const parentKey = actualKeysBySeedKey.get(seed.parentKey!) ?? seed.parentKey!;
    const parent = await scopes.getScopeByKey(parentKey);
    if (!parent) throw new SeedReferenceError('scope', seed.parentKey!, 'scopeScopes');
    const existingRelation = relationsByChild.get(child.key);
    if (existingRelation?.parentKey === parent.key) continue;
    if (existingRelation) {
      await scopes.removeScopeRelation(existingRelation.parentKey, child.key);
    }
    const relation = await scopes.addScopeRelation(parent.key, child.key);
    relationsByChild.set(child.key, relation);
    results.push({ collection: 'scopeScopes', key: relation.key, status: 'created' });
  }

  const productScopeKeys = Object.fromEntries(CANONICAL_APPS.map((product) => {
    const scope = scopesBySlug.get(product.slug);
    if (!scope) throw new SeedReferenceError('scope', product.slug, 'managed scope directory');
    return [product.slug, scope.key];
  })) as ManagedScopeDirectoryTargets;
  const directory = await reconcileManagedScopeDirectory({ products: CANONICAL_APPS.map(managedScopeDirectoryProduct), targetScopeKeys: productScopeKeys });
  results.push({ collection: 'managedScopeDirectory', key: scopesBySlug.get('vorinthex-ai')!.key, status: directory.records.created > 0 ? 'created' : 'updated' });

  const membershipReconciliation = await reconcileTeamScopeMemberships(rootTeam.key);
  results.push(...membershipReconciliation.created.map(({ key }) => ({ collection: 'scopeMembers', key, status: 'created' as const })));

  for (const orchestrator of SEEDED_ORCHESTRATOR_SOURCES) {
    results.push(await upsertSeedOrchestrator(orchestrator));
  }
  const hqScope = await scopes.getScopeByKey(actualKeysBySeedKey.get('cmrnlzf640005qc7kefvra0bn') ?? 'cmrnlzf640005qc7kefvra0bn');
  if (!hqScope) throw new SeedReferenceError('scope', 'hq', 'general channel');
  const generalCursor = await db.query<{ key: string }>(`
    UPSERT { teamKey: @teamKey, kind: "group", name: "general" }
      INSERT { _key: @key, teamKey: @teamKey, scopeKey: @scopeKey, kind: "group", name: "general", description: "Team-wide conversation", position: 0, createdAt: @now, updatedAt: @now, embedding: [] }
      UPDATE { scopeKey: @scopeKey, archivedAt: null, updatedAt: @now } IN channels OPTIONS { keepNull: false }
      RETURN { key: NEW._key }
  `, { key: newId(), teamKey: rootTeam.key, scopeKey: hqScope.key, now: now() });
  const general = (await generalCursor.next())!;
  results.push({ collection: 'channels', key: general.key, status: 'updated' });
  const orchestratorCursor = await db.query<{ key: string }>('FOR orchestrator IN orchestrators FILTER orchestrator.name IN @names SORT orchestrator.name ASC, orchestrator._key ASC RETURN { key: orchestrator._key }', { names: CANONICAL_ORCHESTRATOR_NAMES });
  for (const orchestrator of await orchestratorCursor.all()) {
    const participantKey = newId();
    const participantCursor = await db.query<{ key: string }>(`
      UPSERT { channelKey: @channelKey, orchestratorKey: @orchestratorKey }
        INSERT { _key: @key, scopeKey: @scopeKey, channelKey: @channelKey, orchestratorKey: @orchestratorKey, joinedAt: @now, createdAt: @now, updatedAt: @now, embedding: [] }
        UPDATE { scopeKey: @scopeKey, updatedAt: @now } IN channelParticipants
        RETURN { key: NEW._key }
    `, { key: participantKey, scopeKey: hqScope.key, channelKey: general.key, orchestratorKey: orchestrator.key, now: now() });
    const participant = (await participantCursor.next())!;
    results.push({ collection: 'channelParticipants', key: participant.key, status: participant.key === participantKey ? 'created' : 'updated' });
  }
  results.push(...await assignSeededFounderOrchestrators(rootTeam.key));

  return results;
}

if (import.meta.main) {
  try {
    const results = await seedCoreDbNodes();
    console.table(results);
  } catch (error) {
    if (!isProviderError(error) || !error.retryable) throw error;
    console.warn(`Database seed deferred because ${error.providerId} is unavailable (${error.code}).`);
  } finally {
    await closeDb();
  }
}
