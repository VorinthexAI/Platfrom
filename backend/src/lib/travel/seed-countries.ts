import { createHash } from 'node:crypto';
import type { Database } from 'arangojs';
import { isProviderError } from '@/lib/ai/providers/errors';
import { currentEmbeddingSchema, embedTexts } from '@/lib/embeddings';
import { COUNTRY_CATALOG } from './country-catalog';

export type CountrySeedResult = { collection: 'countries'; key: string; status: 'created' | 'updated' };

type CountrySeedDatabase = Pick<Database, 'query'>;

export async function seedCountryCatalog(
  database: CountrySeedDatabase,
  options: { embed?: typeof embedTexts; skipRetryable?: boolean } = {},
): Promise<CountrySeedResult[]> {
  const embed = options.embed ?? embedTexts;
  const results: CountrySeedResult[] = [];
  const pending: Array<{ country: (typeof COUNTRY_CATALOG)[number]; semanticHash: string; currentKey?: string }> = [];
  for (const country of COUNTRY_CATALOG) {
    const semanticHash = createHash('sha256').update(country.name).digest('hex');
    const currentCursor = await database.query('FOR country IN countries FILTER country.countryCode == @countryCode LIMIT 1 RETURN { key: country._key, semanticVersion: country.semanticVersion, semanticHash: country.semanticHash }', { countryCode: country.countryCode });
    const current = await currentCursor.next() as { key: string; semanticVersion?: number; semanticHash?: string } | null;
    if (current?.semanticVersion === 1 && current.semanticHash === semanticHash) {
      await database.query('UPDATE @key WITH { name: @name, latitude: @latitude, longitude: @longitude } IN countries', { key: current.key, name: country.name, latitude: country.latitude, longitude: country.longitude });
      results.push({ collection: 'countries', key: current.key, status: 'updated' });
      continue;
    }
    pending.push({ country, semanticHash, currentKey: current?.key });
  }
  if (!pending.length) return results;
  let embeddings: number[][];
  try {
    embeddings = await embed({ texts: pending.map(({ country }) => country.name) });
  } catch (error) {
    if (options.skipRetryable && isProviderError(error) && error.retryable) {
      console.warn(`countries: semantic seed refresh deferred because ${error.providerId} is unavailable (${error.code}).`);
      return results;
    }
    throw error;
  }
  if (embeddings.length !== pending.length) throw new Error(`Country seed expected ${pending.length} embeddings and received ${embeddings.length}.`);
  for (const [index, item] of pending.entries()) {
    const embedding = currentEmbeddingSchema.parse(embeddings[index]);
    const cursor = await database.query('UPSERT { countryCode: @countryCode } INSERT @country UPDATE { name: @name, latitude: @latitude, longitude: @longitude, embedding: @embedding, semanticVersion: 1, semanticHash: @semanticHash } IN countries RETURN NEW._key', {
      countryCode: item.country.countryCode,
      name: item.country.name,
      latitude: item.country.latitude,
      longitude: item.country.longitude,
      semanticHash: item.semanticHash,
      embedding,
      country: { _key: item.country.key, ...item.country, embedding, semanticVersion: 1, semanticHash: item.semanticHash },
    });
    results.push({ collection: 'countries', key: String(await cursor.next()), status: item.currentKey ? 'updated' : 'created' });
  }
  return results;
}
