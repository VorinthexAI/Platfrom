import { join } from 'node:path';
import { closeDb } from './client';
import { newId } from '@/lib/ids';
import { getRootOrganization, insertOrganization, updateOrganization, type Organization } from './organizations.node';
import { getProductByProductId, insertProduct, updateProduct, type Product } from './products.node';
import { getVoiceByProviderModelVoice, insertVoice, updateVoice, type Voice } from './voices.node';
import { getOrchestratorByName, insertOrchestrator, updateOrchestrator, type Orchestrator } from './orchestrators.node';

type SeedResult = {
  collection: string;
  key: string;
  status: 'created' | 'updated';
};

const now = () => new Date().toISOString();

export const SEEDED_PRODUCTS = [
  {
    productId: 'private.beta.access',
    name: 'Private beta',
    type: 'subscription' as const,
    priceCents: 79900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'founder.access',
    name: 'Founder',
    type: 'subscription' as const,
    priceCents: 199900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'enterprise.access',
    name: 'Enterprise',
    type: 'subscription' as const,
    priceCents: 599900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'private.beta.access.ticket',
    name: 'Private beta ticket',
    type: 'one_time' as const,
    priceCents: 9900,
    billingPeriod: null,
    gracePeriod: null,
  },
];

export const SEEDED_ORGANIZATION = {
  name: 'Vorinthex AI',
  is_root: true,
  metadata: {},
};

// Sourced from scripts/orchestrators/*/message.metadata.json — every Kokoro
// voice already used for a generated Command orchestrator greeting, plus the
// premium Gemini TTS voice used for launch-asset voiceovers.
export const SEEDED_VOICES = [
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'am_onyx', language: 'en', format: 'mp3' }, // atlas-ceo
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'am_michael', language: 'en', format: 'mp3' }, // apollo-cso
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'af_kore', language: 'en', format: 'mp3' }, // athena-cpo
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'am_fenrir', language: 'en', format: 'mp3' }, // forge-cto
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'bm_daniel', language: 'en', format: 'mp3' }, // hermes-coo
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'af_aoede', language: 'en', format: 'mp3' }, // iris-cco
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'bm_george', language: 'en', format: 'mp3' }, // ledger-cfo
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'am_echo', language: 'en', format: 'mp3' }, // mercury-cro
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'bf_emma', language: 'en', format: 'mp3' }, // metis-cio
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'af_nova', language: 'en', format: 'mp3' }, // orbit-cmo
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'am_adam', language: 'en', format: 'mp3' }, // sentinel-ciso
  { provider: 'openrouter', model: 'hexgrad/kokoro-82m', modelLabel: 'Kokoro 82M', voice: 'bf_isabella', language: 'en', format: 'mp3' }, // themis-clo
  // Premium AI product voiceover default (launch assets), distinct from the
  // Kokoro orchestrator greetings above.
  { provider: 'openrouter', model: 'google/gemini-3.1-flash-tts-preview', modelLabel: 'Gemini 3.1 Flash TTS Preview', voice: 'Charon', language: 'en', format: 'mp3' },
];

// The Command orchestrator roster: one per scripts/orchestrators/<slug>-<role>
// directory. `voice` here must match a (provider, model, voice) already in
// SEEDED_VOICES above, and `dir` locates that orchestrator's SKILL.md.
const SEEDED_ORCHESTRATOR_SOURCES = [
  { dir: 'atlas-ceo', name: 'Atlas', role: 'CEO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_onyx' },
  { dir: 'apollo-cso', name: 'Apollo', role: 'CSO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_michael' },
  { dir: 'athena-cpo', name: 'Athena', role: 'CPO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_kore' },
  { dir: 'forge-cto', name: 'Forge', role: 'CTO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_fenrir' },
  { dir: 'hermes-coo', name: 'Hermes', role: 'COO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bm_daniel' },
  { dir: 'iris-cco', name: 'Iris', role: 'CCO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_aoede' },
  { dir: 'ledger-cfo', name: 'Ledger', role: 'CFO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bm_george' },
  { dir: 'mercury-cro', name: 'Mercury', role: 'CRO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_echo' },
  { dir: 'metis-cio', name: 'Metis', role: 'CIO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bf_emma' },
  { dir: 'orbit-cmo', name: 'Orbit', role: 'CMO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_nova' },
  { dir: 'sentinel-ciso', name: 'Sentinel', role: 'CISO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_adam' },
  { dir: 'themis-clo', name: 'Themis', role: 'CLO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bf_isabella' },
];

// backend/src/lib/db -> repo root, then into the checked-in orchestrator
// source directory (present on a full checkout, e.g. the CI deploy job's
// runner, regardless of this script's own working directory).
const ORCHESTRATORS_SOURCE_DIR = join(import.meta.dir, '../../../../scripts/orchestrators');

function loadOrchestratorSkill(dir: string): Promise<string> {
  return Bun.file(join(ORCHESTRATORS_SOURCE_DIR, dir, 'SKILL.md')).text();
}

async function upsertSeedOrganization(seed: typeof SEEDED_ORGANIZATION): Promise<SeedResult> {
  const existing = await getRootOrganization();
  if (!existing) {
    const key = newId();
    await insertOrganization({
      key,
      name: seed.name,
      is_root: seed.is_root,
      metadata: seed.metadata,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'organizations', key, status: 'created' };
  }

  const patch: Partial<Omit<Organization, 'key' | 'embedding'>> = {
    name: seed.name,
    is_root: seed.is_root,
    metadata: seed.metadata,
    updatedAt: now(),
  };
  await updateOrganization(existing.key, patch);
  return { collection: 'organizations', key: existing.key, status: 'updated' };
}

async function upsertSeedProduct(seed: (typeof SEEDED_PRODUCTS)[number]): Promise<SeedResult> {
  const existing = await getProductByProductId(seed.productId);
  if (!existing) {
    const key = newId();
    await insertProduct({
      ...seed,
      key,
      polarProductId: null,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'products', key, status: 'created' };
  }

  const patch: Partial<Omit<Product, 'key' | 'embedding'>> = {
    productId: seed.productId,
    name: seed.name,
    type: seed.type,
    priceCents: seed.priceCents,
    billingPeriod: seed.billingPeriod,
    gracePeriod: seed.gracePeriod,
    updatedAt: now(),
  };
  await updateProduct(existing.key, patch);
  return { collection: 'products', key: existing.key, status: 'updated' };
}

async function upsertSeedVoice(seed: (typeof SEEDED_VOICES)[number]): Promise<SeedResult> {
  const existing = await getVoiceByProviderModelVoice(seed.provider, seed.model, seed.voice);
  if (!existing) {
    const key = newId();
    await insertVoice({
      ...seed,
      key,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'voices', key, status: 'created' };
  }

  const patch: Partial<Omit<Voice, 'key' | 'embedding'>> = {
    modelLabel: seed.modelLabel,
    language: seed.language,
    format: seed.format,
    updatedAt: now(),
  };
  await updateVoice(existing.key, patch);
  return { collection: 'voices', key: existing.key, status: 'updated' };
}

async function upsertSeedOrchestrator(seed: (typeof SEEDED_ORCHESTRATOR_SOURCES)[number]): Promise<SeedResult> {
  const voice = await getVoiceByProviderModelVoice(seed.provider, seed.model, seed.voice);
  if (!voice) {
    throw new Error(`Seed voice not found for orchestrator "${seed.name}": ${seed.provider}/${seed.model}/${seed.voice}`);
  }
  const skill = await loadOrchestratorSkill(seed.dir);

  const existing = await getOrchestratorByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertOrchestrator({
      key,
      name: seed.name,
      role: seed.role,
      voiceId: voice.key,
      skill,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'orchestrators', key, status: 'created' };
  }

  const patch: Partial<Omit<Orchestrator, 'key' | 'embedding'>> = {
    role: seed.role,
    voiceId: voice.key,
    skill,
    updatedAt: now(),
  };
  await updateOrchestrator(existing.key, patch);
  return { collection: 'orchestrators', key: existing.key, status: 'updated' };
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  const results: SeedResult[] = [];

  results.push(await upsertSeedOrganization(SEEDED_ORGANIZATION));

  for (const product of SEEDED_PRODUCTS) {
    results.push(await upsertSeedProduct(product));
  }

  for (const voice of SEEDED_VOICES) {
    results.push(await upsertSeedVoice(voice));
  }

  for (const orchestrator of SEEDED_ORCHESTRATOR_SOURCES) {
    results.push(await upsertSeedOrchestrator(orchestrator));
  }

  return results;
}

if (import.meta.main) {
  try {
    const results = await seedCoreDbNodes();
    console.table(results);
  } finally {
    await closeDb();
  }
}
