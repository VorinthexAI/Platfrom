import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { CANONICAL_APPS } from './registry';
import { APP_LOGO_MANIFEST, APP_LOGO_PREFIX } from './logo-manifest';

describe('app logo manifest', () => {
  test('covers every canonical app with a checked-in PNG and versioned key', async () => {
    expect(Object.keys(APP_LOGO_MANIFEST).sort()).toEqual(CANONICAL_APPS.map(({ slug }) => slug).sort());
    for (const app of CANONICAL_APPS) {
      const asset = APP_LOGO_MANIFEST[app.slug as keyof typeof APP_LOGO_MANIFEST];
      expect(asset.storageKey).toStartWith(APP_LOGO_PREFIX);
      expect(asset.storageKey).toEndWith('.png');
      expect(app.logoStorageKey).toBe(asset.storageKey);
      expect(await Bun.file(resolve(import.meta.dir, '../../../../', asset.sourcePath)).exists()).toBe(true);
    }
  });
});
