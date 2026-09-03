import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { CANONICAL_APPS } from '@/lib/apps/registry';
import { createListApps } from './apps';

describe('GET /api/v1/apps', () => {
  test('returns strict sorted public apps without caching or an app-key header', async () => {
    const apps = CANONICAL_APPS.map((app, index) => ({ ...app, createdAt: `2026-09-0${index + 1}T00:00:00.000Z`, updatedAt: `2026-09-0${index + 1}T00:00:00.000Z` })).sort((a, b) => a.slug.localeCompare(b.slug));
    const app = new Hono().get('/api/v1/apps', createListApps(async () => [...apps].reverse()));
    const response = await app.request('/api/v1/apps');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ apps });
  });

  test('allows only the app-key header through CORS and leaves health unchanged', async () => {
    const source = await Bun.file(new URL('./index.ts', import.meta.url)).text();
    expect(source).toContain("'X-Vorinthex-App-Key'");
    expect(source).not.toContain('X-Vorinthex-Domain');
    expect(source).toContain("api.get('/health', (c) => c.json({ ok: true }))");
  });
});
