import { documentStorage } from '@/lib/ai/document-processing/storage';
import { newId } from '@/lib/ids';
import { stagedPlaceImageKey, type PlaceImageMetrics } from '@/lib/travel/place-images';
import type { TravelRepository } from '@/lib/travel/repository';
import { createTravelService } from '@/lib/travel/service';
import sharp from 'sharp';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the live place guide benchmark.');
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for the live place guide benchmark.');

const destinations = [
  { country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2048, lon: 138.2529 }, city: 'Tokyo' },
  { country: { name: 'Portugal', code: 'PT', continent: 'Europe', lat: 39.3999, lon: -8.2245 }, city: 'Lisbon' },
  { country: { name: 'Kenya', code: 'KE', continent: 'Africa', lat: 0.0236, lon: 37.9062 }, city: 'Nairobi' },
] as const;

type Result = { destination: string; kind: 'country' | 'city'; guideMs: number; heroMs: number; totalMs: number; providerMs: number | null; stagingMs: number | null; simulatedWebpMs: number | null; summaryWords: number };
const results: Result[] = [];
const destinationLimit = Number.parseInt(process.env.PLACE_BENCHMARK_LIMIT ?? String(destinations.length), 10);
const benchmarkKind = process.env.PLACE_BENCHMARK_KIND as 'country' | 'city' | undefined;

for (const destination of destinations.slice(0, Number.isFinite(destinationLimit) ? destinationLimit : destinations.length)) {
  let lastSealed: { nonce?: string } | undefined;
  const imageMetrics: { current?: PlaceImageMetrics } = {};
  const tokens = new Map<string, unknown>();
  const service = createTravelService({
    repository: { authorizeRead: async () => {} } as unknown as TravelRepository,
    encryptImageRequest: (value) => { const token = `live-${newId()}`; tokens.set(token, value); lastSealed = value as { nonce?: string }; return token; },
    decryptImageRequest: (token) => tokens.get(token),
    placeImages: { log: () => {}, onMetrics: (metrics) => { imageMetrics.current = metrics; } },
  });
  const context = { organizationKey: 'place-guide-live', scopeKey: newId() };

  const measure = async (kind: 'country' | 'city') => {
    delete imageMetrics.current;
    const started = performance.now();
    const detail = kind === 'country'
      ? (await service.findPlaceGuide({ ...context, query: destination.country.name, country: destination.country }, 'live-user', { timeoutMs: 60_000 })).place
      : (await service.findCity({ ...context, city: destination.city, country: destination.country }, 'live-user', { timeoutMs: 60_000 })).city;
    const guideMs = Math.round(performance.now() - started);
    const heroStarted = performance.now();
    const image = await service.generatePlaceHeroImage({ ...context, imageRequestToken: detail.imageRequestToken }, 'live-user', { timeoutMs: 120_000 });
    const heroMs = Math.round(performance.now() - heroStarted);
    const totalMs = Math.round(performance.now() - started);
    if (!image.image.url.startsWith('data:image/png;base64,')) throw new Error(`${detail.title} did not return a generated hero.`);
    const metrics = imageMetrics.current as PlaceImageMetrics | undefined;
    let simulatedWebpMs: number | null = null;
    if (lastSealed?.nonce) {
      const staged = await documentStorage.download(stagedPlaceImageKey(lastSealed.nonce));
      const conversionStarted = performance.now();
      await sharp(staged.bytes, { animated: false, failOn: 'error', limitInputPixels: 40_000_000 }).resize(1536, 864, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();
      simulatedWebpMs = Math.round(performance.now() - conversionStarted);
    }
    results.push({ destination: detail.title, kind, guideMs, heroMs, totalMs, providerMs: metrics?.providerDurationMs ?? null, stagingMs: metrics?.stagingMs ?? null, simulatedWebpMs, summaryWords: detail.summary.split(/\s+/).filter(Boolean).length });
    if (lastSealed?.nonce) await documentStorage.delete(stagedPlaceImageKey(lastSealed.nonce)).catch(() => undefined);
  };

  if (!benchmarkKind || benchmarkKind === 'country') await measure('country');
  if (!benchmarkKind || benchmarkKind === 'city') await measure('city');
}

const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
console.table(results);
console.log(JSON.stringify({
  samples: results.length,
  averageGuideMs: average(results.map(({ guideMs }) => guideMs)),
  averageHeroMs: average(results.map(({ heroMs }) => heroMs)),
  averageTotalMs: average(results.map(({ totalMs }) => totalMs)),
  fastestTotalMs: Math.min(...results.map(({ totalMs }) => totalMs)),
  slowestTotalMs: Math.max(...results.map(({ totalMs }) => totalMs)),
}, null, 2));
