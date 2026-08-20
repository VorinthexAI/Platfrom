import { newId } from '@/lib/ids';
import { createTravelService } from '@/lib/travel/service';
import type { TravelRepository } from '@/lib/travel/repository';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required for the live place web-search benchmark.');

const countries = [
  { name: 'Japan', code: 'JP', continent: 'Asia', capital: 'Tokyo', lat: 36.2048, lon: 138.2529 },
  { name: 'Brazil', code: 'BR', continent: 'South America', capital: 'Brasilia', lat: -14.235, lon: -51.9253 },
  { name: 'Kenya', code: 'KE', continent: 'Africa', capital: 'Nairobi', lat: 0.0236, lon: 37.9062 },
  { name: 'Norway', code: 'NO', continent: 'Europe', capital: 'Oslo', lat: 60.472, lon: 8.4689 },
  { name: 'New Zealand', code: 'NZ', continent: 'Oceania', capital: 'Wellington', lat: -40.9006, lon: 174.886 },
  { name: 'Canada', code: 'CA', continent: 'North America', capital: 'Ottawa', lat: 56.1304, lon: -106.3468 },
  { name: 'India', code: 'IN', continent: 'Asia', capital: 'New Delhi', lat: 20.5937, lon: 78.9629 },
  { name: 'Morocco', code: 'MA', continent: 'Africa', capital: 'Rabat', lat: 31.7917, lon: -7.0926 },
] as const;

const durations: number[] = [];
const results: Array<{ country: string; durationMs: number; facts: number; citations: number; images: number }> = [];
for (const country of countries) {
  let sealed: unknown;
  const token = `live-${country.code}-${newId()}`;
  const service = createTravelService({
    repository: { authorizeRead: async () => {} } as unknown as TravelRepository,
    encryptImageRequest: (value) => { sealed = value; return token; },
    decryptImageRequest: () => sealed,
    placeImages: { log: () => {} },
  });
  const scopeKey = newId();
  const started = performance.now();
  const { capital: _capital, ...countryInput } = country;
  const { place } = await service.findPlace({ organizationKey: 'place-web-search-live', scopeKey, query: country.name, country: countryInput }, 'live-user', { timeoutMs: 60_000 });
  const imageSet = await service.generatePlaceImages({ organizationKey: 'place-web-search-live', scopeKey, imageRequestToken: token }, 'live-user');
  const durationMs = Math.round(performance.now() - started);
  const factualText = JSON.stringify({ summary: place.summary, facts: place.facts, highlights: place.highlights }).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  if (!factualText.includes(country.name.toLocaleLowerCase()) && !factualText.includes(country.capital.toLocaleLowerCase())) throw new Error(`${country.name} response did not contain country-specific text.`);
  if (place.facts.length < 3 || place.highlights.length < 1) throw new Error(`${country.name} response did not contain enough factual text.`);
  if (place.sources.length === 0) throw new Error(`${country.name} response did not contain cited web sources.`);
  if (imageSet.images.length === 0) throw new Error(`${country.name} response did not contain a usable image.`);
  durations.push(durationMs);
  results.push({ country: country.name, durationMs, facts: place.facts.length, citations: place.sources.length, images: imageSet.images.length });
}

const ordered = [...durations].sort((left, right) => left - right);
const percentile = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]!;
console.table(results);
console.log(JSON.stringify({
  countries: results.length,
  averageMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  fastestMs: ordered[0],
  slowestMs: ordered.at(-1),
}, null, 2));
