import { newId } from '@/lib/ids';
import { createTravelService } from '@/lib/travel/service';
import type { TravelRepository } from '@/lib/travel/repository';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required for the live place guide benchmark.');

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
const results: Array<{ country: string; guideMs: number; heroMs: number; totalMs: number; summaryWords: number; cities: number }> = [];
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
  const guideMs = Math.round(performance.now() - started);
  const imageStarted = performance.now();
  const imageSet = await service.generatePlaceHeroImage({ organizationKey: 'place-web-search-live', scopeKey, imageRequestToken: token }, 'live-user', { timeoutMs: 90_000 });
  const heroMs = Math.round(performance.now() - imageStarted);
  const totalMs = Math.round(performance.now() - started);
  const factualText = JSON.stringify({ summary: place.summary, culture: place.culture, food: place.food, whyVisit: place.whyVisit, popularCities: place.popularCities }).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  const summaryWords = place.summary.split(/\s+/).filter(Boolean).length;
  if (!factualText.includes(country.name.toLocaleLowerCase()) && !factualText.includes(country.capital.toLocaleLowerCase())) throw new Error(`${country.name} response did not contain country-specific text.`);
  if (summaryWords < 60 || summaryWords > 110 || !place.culture || !place.food || !place.whyVisit) throw new Error(`${country.name} response did not satisfy the focused travel contract.`);
  if (place.popularCities.length !== 10 || new Set(place.popularCities.map(({ name }) => name.toLocaleLowerCase())).size !== 10) throw new Error(`${country.name} response did not contain ten distinct cities with coordinates.`);
  if (!imageSet.image.url.startsWith('data:image/webp;base64,')) throw new Error(`${country.name} response did not contain a generated hero.`);
  durations.push(totalMs);
  results.push({ country: country.name, guideMs, heroMs, totalMs, summaryWords, cities: place.popularCities.length });
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
