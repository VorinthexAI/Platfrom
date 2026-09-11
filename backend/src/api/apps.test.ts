import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { CANONICAL_APPS } from '@/lib/apps/registry';
import { createAppsService } from '@/lib/apps/service';
import { createListApps } from './apps';

describe('GET /api/v1/apps', () => {
  const scopes = CANONICAL_APPS.map((app, index) => ({ key: `cm00000000000000000000${String(index).padStart(2, '0')}`, teamKey: 'root', slug: app.slug, name: app.name, summary: app.description, description: app.detailedDescription, position: index + 1, level: 1, embedding: [] }));
  const readCatalog = async () => CANONICAL_APPS.map(({ key, name, description, detailedDescription }) => ({ key, name, description, detailedDescription }));
  test('returns strict sorted public apps without caching or an app-key header', async () => {
    const apps = [...CANONICAL_APPS].sort((a, b) => a.slug.localeCompare(b.slug));
    const service = createAppsService({ list: async () => [...scopes].reverse() }, async (key) => `https://assets.example/${key}`, readCatalog);
    const app = new Hono().get('/api/v1/apps', createListApps(service));
    const response = await app.request('/api/v1/apps');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { apps: Array<Record<string, unknown>> };
    expect(body.apps.map(({ slug }) => slug)).toEqual(apps.map(({ slug }) => slug));
    expect(body.apps[0].logoUrl).toBe(`https://assets.example/${apps[0].logoStorageKey}`);
    expect(body.apps[0]).not.toHaveProperty('logoStorageKey');
  });

  test('allows only the app-key header through CORS and leaves health unchanged', async () => {
    const source = await Bun.file(new URL('./index.ts', import.meta.url)).text();
    expect(source).toContain("'X-Vorinthex-App-Key'");
    expect(source).not.toContain('X-Vorinthex-Domain');
    expect(source).toContain("api.get('/health', (c) => c.json({ ok: true }))");
  });
});
