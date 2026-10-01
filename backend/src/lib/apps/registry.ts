import { z } from 'zod';
import { APP_LOGO_MANIFEST } from './logo-manifest';

export const appDetailedDescriptionSchema = z.string().trim().min(1).max(5_000);
export const appAliasKeySchema = z.string().cuid();
export const appSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const CATALOG_TIMESTAMP = '2026-09-01T00:00:00.000Z';

export const APP_KEYS = {
  CORE: 'cmtlinos60006w07k04cc0cvr',
} as const;

export const CANONICAL_APPS = [
  {
    key: APP_KEYS.CORE,
    slug: 'core',
    name: 'Core',
    description: 'Your personal AI for conversation and files across your scopes.',
    detailedDescription: 'Core is the personal AI agent at the center of Vorinthex. It searches folders and files in the scope you choose, answers questions, and generates images in conversation.',
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
export const CANONICAL_APP_BY_ALIAS = new Map(CANONICAL_APPS.map((app) => [app.key, app]));
export const CANONICAL_APP_BY_SLUG = new Map(CANONICAL_APPS.map((app) => [app.slug, app]));

export function parseAppAliasKey(value: unknown): string {
  const key = appAliasKeySchema.parse(value);
  if (!CANONICAL_APP_BY_ALIAS.has(key)) throw new Error(`Unknown application alias: ${key}`);
  return key;
}
