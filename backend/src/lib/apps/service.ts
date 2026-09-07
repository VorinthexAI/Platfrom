import { z } from 'zod';
import { signedAppLogoUrl } from './logo-url';
import { appDetailedDescriptionSchema, appSlugSchema, CANONICAL_APP_BY_ALIAS, CANONICAL_APPS, parseAppAliasKey } from './registry';
import { createProductScopeRepository, requireProductScopes } from './repository';
import { readManagedScopeDirectoryCatalog } from '@/lib/managed-scope-directory';

export const enrichedAppSchema = z.object({
  key: z.string().cuid(),
  slug: appSlugSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1),
  detailedDescription: appDetailedDescriptionSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type App = z.infer<typeof enrichedAppSchema>;
export const publicAppSchema = enrichedAppSchema.extend({ logoUrl: z.string().url() }).strict();
export type PublicAppResponse = z.infer<typeof publicAppSchema>;

export interface AppsService {
  list(): Promise<App[]>;
  listPublic(): Promise<PublicAppResponse[]>;
  resolveAlias(aliasKey: string): Promise<{ aliasKey: string; scopeKey: string }>;
}

export function createAppsService(
  repository: ReturnType<typeof createProductScopeRepository> = createProductScopeRepository(),
  signLogoUrl: (storageKey: string) => Promise<string> = signedAppLogoUrl,
  readCatalog: typeof readManagedScopeDirectoryCatalog = readManagedScopeDirectoryCatalog,
): AppsService {
  const scopes = () => requireProductScopes(repository);
  const list = async () => {
    const bySlug = await scopes();
    const motherScopeKey = bySlug.get('vorinthex-ai')!.key;
    const directoryByAlias = new Map((await readCatalog(motherScopeKey)).map((entry) => [entry.key, entry]));
    return CANONICAL_APPS.map((presentation) => {
      const directory = directoryByAlias.get(presentation.key);
      if (!directory) throw new Error(`Managed scope directory is missing product ${presentation.slug}.`);
      return enrichedAppSchema.parse({
        key: presentation.key,
        slug: presentation.slug,
        name: presentation.name,
        description: directory.description,
        detailedDescription: directory.detailedDescription,
        version: presentation.version,
        createdAt: presentation.createdAt,
        updatedAt: presentation.updatedAt,
      });
    }).sort((left, right) => left.slug.localeCompare(right.slug) || left.key.localeCompare(right.key));
  };
  return {
    list,
    async resolveAlias(rawAliasKey) {
      const aliasKey = parseAppAliasKey(rawAliasKey);
      const presentation = CANONICAL_APP_BY_ALIAS.get(aliasKey)!;
      return { aliasKey, scopeKey: (await scopes()).get(presentation.slug)!.key };
    },
    async listPublic() {
      return Promise.all((await list()).map(async (app) => {
        const presentation = CANONICAL_APPS.find(({ slug }) => slug === app.slug)!;
        return publicAppSchema.parse({ ...app, logoUrl: await signLogoUrl(presentation.logoStorageKey) });
      }));
    },
  };
}

export const appsService = createAppsService();
