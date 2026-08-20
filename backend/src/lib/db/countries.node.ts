import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { countryCodeSchema } from './users.node';
import { createNodeHelpers } from './base';

export const COUNTRIES_COLLECTION = 'countries';
export const countrySchema = z.object({
  key: z.string().cuid(), name: z.string().trim().min(1), countryCode: countryCodeSchema,
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  embedding: currentEmbeddingSchema, semanticVersion: z.literal(1), semanticHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Country = z.infer<typeof countrySchema>;
export const countriesEmbeddingFields = ['name'] as const;
const helpers = createNodeHelpers(COUNTRIES_COLLECTION, countrySchema, countriesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertCountry = helpers.insert;
export const getCountryById = helpers.getById;
export const upsertCountryByKey = helpers.upsertByKey;
export const getAllCountriesChunked = helpers.getAllChunked;
export const listCountriesPage = helpers.listPage;
