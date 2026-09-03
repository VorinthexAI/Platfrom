import type { PublicApp } from '@/lib/db/apps.node';
import { appsRepository } from '@/lib/db/apps.node';

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
  { key: APP_KEYS.VORINTHEX_AI, slug: 'vorinthex-ai', name: 'Vorinthex AI', description: 'An AI-native platform unifying intelligence, knowledge, creation, and execution.' },
  { key: APP_KEYS.ARCHIVE, slug: 'archive', name: 'Archive', description: 'Capture, organize, connect, and semantically search notes, documents, and knowledge.' },
  { key: APP_KEYS.GALLERY, slug: 'gallery', name: 'Gallery', description: 'Organize, discover, generate, and share images, collections, and memories.' },
  { key: APP_KEYS.COMPASS, slug: 'compass', name: 'Compass', description: 'Explore destinations, plan trips, and preserve intelligent travel guides.' },
  { key: APP_KEYS.SIGNAL, slug: 'signal', name: 'Signal', description: 'Prioritize connected inboxes and compose context-aware email in your voice.' },
  { key: APP_KEYS.ASCEND, slug: 'ascend', name: 'Ascend', description: 'Create personalized books and guided learning journeys for meaningful goals.' },
  { key: APP_KEYS.CORE, slug: 'core', name: 'Core', description: 'Your personal AI agent connecting everything across Vorinthex AI.' },
].map((app) => ({ ...app, version: '1.0.0' })) as ReadonlyArray<Pick<PublicApp, 'key' | 'slug' | 'name' | 'description' | 'version'>>;

export const APP_KEYS_BY_SLUG = Object.freeze(Object.fromEntries(CANONICAL_APPS.map(({ slug, key }) => [slug, key])) as Record<(typeof CANONICAL_APPS)[number]['slug'], string>);

type AppsRepository = Pick<typeof appsRepository, 'getByKey' | 'insert' | 'update'>;

export async function seedApps(repository: AppsRepository = appsRepository, now: () => string = () => new Date().toISOString()) {
  const results: Array<{ collection: 'apps'; key: string; status: 'created' | 'updated' }> = [];
  for (const seed of CANONICAL_APPS) {
    const existing = await repository.getByKey(seed.key);
    if (!existing) {
      const timestamp = now();
      await repository.insert({ ...seed, createdAt: timestamp, updatedAt: timestamp });
      results.push({ collection: 'apps', key: seed.key, status: 'created' });
      continue;
    }
    if (existing.slug === seed.slug && existing.name === seed.name && existing.description === seed.description && existing.version === seed.version) continue;
    await repository.update(seed.key, { ...seed, updatedAt: now() });
    results.push({ collection: 'apps', key: seed.key, status: 'updated' });
  }
  return results;
}
