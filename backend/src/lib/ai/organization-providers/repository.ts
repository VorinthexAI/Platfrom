import { db } from '@/lib/db/client';
import { isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { PROVIDER_NAMES, providerIdSchema, type ProviderId } from '@/lib/ai/providers/types';
import {
  ORGANIZATION_PROVIDERS_COLLECTION,
  organizationProviderKey,
  organizationProviderSchema,
  type OrganizationProvider,
} from './schema';
import {
  DuplicateOrganizationProviderError,
  InvalidOrganizationIdError,
  OrganizationProviderNotFoundError,
  UnknownProviderIdError,
  type OrganizationProviderRepository,
  type OrganizationProvidersDatabase,
} from './types';

function parseOrganizationId(organizationId: string): string {
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) throw new InvalidOrganizationIdError();
  return parsed.data;
}

function parseProviderId(providerId: string): ProviderId {
  const parsed = providerIdSchema.safeParse(providerId);
  if (!parsed.success) throw new UnknownProviderIdError(providerId);
  return parsed.data;
}

/**
 * Data access for the `organizationProviders` allow-list. All queries are
 * parameterized (bind vars) — untrusted strings are never interpolated
 * into AQL.
 */
export function createOrganizationProviderRepository(
  database: OrganizationProvidersDatabase = db,
): OrganizationProviderRepository {
  return {
    async listProviderIds(organizationId) {
      const validOrganizationId = parseOrganizationId(organizationId);
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.organizationId == @organizationId
            SORT doc.providerId ASC
            RETURN doc.providerId
        `,
        { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, organizationId: validOrganizationId },
      );
      const raw = await cursor.all();
      // Documents referencing providers that no longer exist in
      // PROVIDER_IDS are silently ignored — the allow-list can only ever
      // widen to known providers.
      return raw
        .map((value) => providerIdSchema.safeParse(value))
        .filter((parsed): parsed is { success: true; data: ProviderId } => parsed.success)
        .map((parsed) => parsed.data);
    },

    async hasProvider(organizationId, providerId) {
      const validOrganizationId = parseOrganizationId(organizationId);
      const validProviderId = parseProviderId(providerId);
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.organizationId == @organizationId && doc.providerId == @providerId
            LIMIT 1
            RETURN true
        `,
        {
          '@collection': ORGANIZATION_PROVIDERS_COLLECTION,
          organizationId: validOrganizationId,
          providerId: validProviderId,
        },
      );
      return (await cursor.next()) === true;
    },

    async addProvider(organizationId, providerId) {
      const validOrganizationId = parseOrganizationId(organizationId);
      const validProviderId = parseProviderId(providerId);
      // Application code only ever handles `key` — the rename to Arango's
      // `_key` happens exclusively through the shared base.ts translators.
      const document = organizationProviderSchema.parse({
        key: organizationProviderKey(validOrganizationId, validProviderId),
        organizationId: validOrganizationId,
        providerId: validProviderId,
        name: PROVIDER_NAMES[validProviderId],
      });
      try {
        const result = await database
          .collection(ORGANIZATION_PROVIDERS_COLLECTION)
          .save(toArangoDoc({ ...document }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? organizationProviderSchema.parse(withArangoKey(saved)) : document) satisfies OrganizationProvider;
      } catch (err) {
        if (isArangoUniqueConstraintError(err)) {
          throw new DuplicateOrganizationProviderError(validOrganizationId, validProviderId);
        }
        throw err;
      }
    },

    async removeProvider(organizationId, providerId) {
      const validOrganizationId = parseOrganizationId(organizationId);
      const validProviderId = parseProviderId(providerId);
      try {
        await database
          .collection(ORGANIZATION_PROVIDERS_COLLECTION)
          .remove(organizationProviderKey(validOrganizationId, validProviderId));
      } catch (err) {
        if (isArangoNotFoundError(err)) {
          throw new OrganizationProviderNotFoundError(validOrganizationId, validProviderId);
        }
        throw err;
      }
    },
  };
}

let cachedDefaultRepository: OrganizationProviderRepository | null = null;

/** Process-wide repository bound to the shared ArangoDB client. */
export function getDefaultOrganizationProviderRepository(): OrganizationProviderRepository {
  cachedDefaultRepository ??= createOrganizationProviderRepository();
  return cachedDefaultRepository;
}
