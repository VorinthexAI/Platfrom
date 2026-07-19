import { z } from 'zod';
import { aql } from 'arangojs';
import { providerSlugSchema } from '@/lib/ai/providers/types';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const PROVIDERS_COLLECTION = 'providers';

export { providerSlugSchema };
export type ProviderSlug = z.infer<typeof providerSlugSchema>;

export const providerObjectSchema = z.object({
  key: z.string().cuid(),
  slug: providerSlugSchema,
  name: z.string().trim().min(1).max(100),
  handlerKey: providerSlugSchema,
  embedding: z.array(z.number().finite()).default([]),
});

export const providerSchema = providerObjectSchema.superRefine((provider, ctx) => {
  if (provider.slug !== provider.handlerKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['handlerKey'],
      message: 'handlerKey must match slug',
    });
  }
});

export type Provider = z.infer<typeof providerSchema>;

export const providersEmbedKeys = z.enum(['name', 'slug']);

const helpers = createNodeHelpers(PROVIDERS_COLLECTION, providerSchema, providersEmbedKeys.options);

export const insertProvider = helpers.insert;
export const getProviderById = helpers.getById;
export const updateProvider = helpers.updateById;
export const deleteProvider = helpers.deleteById;
export const upsertProviderByKey = helpers.upsertByKey;
export const getAllProvidersChunked = helpers.getAllChunked;
export const listProvidersPage = helpers.listPage;

export async function getProviderBySlug(slug: ProviderSlug): Promise<Provider | null> {
  const cursor = await db.query(aql`
    FOR provider IN ${db.collection(PROVIDERS_COLLECTION)}
      FILTER provider.slug == ${slug}
      LIMIT 1
      RETURN provider
  `);
  const doc = await cursor.next();
  return doc ? providerSchema.parse(withArangoKey(doc)) : null;
}
