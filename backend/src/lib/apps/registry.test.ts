import { describe, expect, test } from 'bun:test';
import { APP_KEYS, APP_KEYS_BY_SLUG, CANONICAL_APPS, parseAppAliasKey, PRODUCT_SCOPE_SLUGS } from './registry';

describe('canonical apps registry', () => {
  test('defines the exact stable app identities and detailed product guidance', () => {
    expect(CANONICAL_APPS.map(({ key, slug, logoStorageKey, version }) => ({ key, slug, logoStorageKey, version }))).toEqual([
      { key: 'cmtlinos40000w07k6xky0v3q', slug: 'vorinthex-ai', logoStorageKey: 'apps/logos/v1/vorinthex-ai.png', version: '1.0.0' },
      { key: 'cmtlinos60001w07k644x6qo3', slug: 'archive', logoStorageKey: 'apps/logos/v1/archive.png', version: '1.0.0' },
      { key: 'cmtlinos60002w07k9ec59vqk', slug: 'gallery', logoStorageKey: 'apps/logos/v1/gallery.png', version: '1.0.0' },
      { key: 'cmtlinos60003w07kg57h2hhq', slug: 'compass', logoStorageKey: 'apps/logos/v1/compass.png', version: '1.0.0' },
      { key: 'cmtlinos60004w07kfuh9fl4i', slug: 'signal', logoStorageKey: 'apps/logos/v1/signal.png', version: '1.0.0' },
      { key: 'cmtlinos60005w07k7cjlfur0', slug: 'ascend', logoStorageKey: 'apps/logos/v1/ascend.png', version: '1.0.0' },
      { key: 'cmtlinos60006w07k04cc0cvr', slug: 'core', logoStorageKey: 'apps/logos/v1/core.png', version: '1.0.0' },
    ]);
    expect(new Set(CANONICAL_APPS.map(({ slug }) => slug)).size).toBe(7);
    for (const app of CANONICAL_APPS) {
      expect(app.description.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
      expect(app.detailedDescription.trim().split(/\s+/).length).toBeGreaterThanOrEqual(70);
    }
    expect(CANONICAL_APPS.find(({ slug }) => slug === 'gallery')?.detailedDescription).toContain('Memories');
    expect(CANONICAL_APPS.find(({ slug }) => slug === 'gallery')?.detailedDescription).toContain('Highlights');
    expect(CANONICAL_APPS.find(({ slug }) => slug === 'gallery')?.detailedDescription).toContain('Image generation');
    const ascend = CANONICAL_APPS.find(({ slug }) => slug === 'ascend');
    expect(ascend?.description).toContain('audio books');
    expect(ascend?.detailedDescription).toContain('personalized audio book');
    expect(APP_KEYS_BY_SLUG.signal).toBe(APP_KEYS.SIGNAL);
  });

  test('accepts only the seven stable transport aliases', () => {
    expect(PRODUCT_SCOPE_SLUGS).toHaveLength(7);
    for (const app of CANONICAL_APPS) expect(parseAppAliasKey(app.key)).toBe(app.key);
    expect(() => parseAppAliasKey('cm0000000000000000000000')).toThrow('Unknown application alias');
  });

  test('does not persist or seed an apps collection', async () => {
    const source = await Bun.file(new URL('../db/seed.ts', import.meta.url)).text();
    expect(source).not.toContain('seedApps');
    expect(source).toContain('const results: SeedResult[] = []');
  });
});
