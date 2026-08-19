import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { imageGenerationService, type ImageGenerationService } from '@/lib/image-generation/service';
import { placeCountryCodeSchema } from '@/lib/db/places.node';
import { decryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import type { TravelAccessContext, TravelRepository } from './repository';

const ROLES = ['hero', 'scene-1', 'scene-2', 'scene-3'] as const;
export const PLACE_IMAGE_TOKEN_MAX_LENGTH = 64 * 1024;
export const PLACE_IMAGE_TOKEN_VALIDITY_MS = 60 * 60_000;
export const PLACE_IMAGE_WEBP_MAX_BYTES = 4 * 1024 * 1024;

export const travelAssetConceptSchema = z.object({
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(4_000),
}).strict();
export const travelAssetConceptsSchema = z.tuple([
  travelAssetConceptSchema, travelAssetConceptSchema, travelAssetConceptSchema, travelAssetConceptSchema,
]).superRefine((concepts, context) => {
  for (const field of ['title', 'prompt'] as const) {
    const normalized = concepts.map((concept) => concept[field].toLocaleLowerCase());
    if (new Set(normalized).size !== concepts.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: `Asset concept ${field}s must be distinct.` });
  }
  concepts.forEach((concept, index) => {
    if (!concept.prompt.toLocaleLowerCase().startsWith(`role: ${ROLES[index]}.`)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'prompt'], message: `Asset concept ${index + 1} must have role ${ROLES[index]}.` });
  });
});
export type TravelAssetConcepts = z.infer<typeof travelAssetConceptsSchema>;

export const travelPlaceImagesInputSchema = z.object({
  organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), imageRequestToken: z.string().min(1).max(PLACE_IMAGE_TOKEN_MAX_LENGTH),
}).strict();
const placeImageTokenSchema = z.object({
  version: z.literal(1), organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(),
  issuedAt: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  country: z.object({ name: z.string().trim().min(1).max(160), countryCode: placeCountryCodeSchema, continent: z.string().trim().min(1).max(80), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
  concepts: travelAssetConceptsSchema,
}).strict();

export type PlaceImageMetrics = { countryCode: string; state: 'ready' | 'failed'; conceptTitles: string[]; providerDurationMs?: number[]; cropMs?: number; totalMs: number; costUsd?: number | null };
export interface PlaceImageDependencies {
  repository: Pick<TravelRepository, 'authorizeRead'>;
  images?: Pick<ImageGenerationService, 'generateRaw'>;
  transform?: (bytes: Uint8Array, output: { width: 864; height: 1536; mimeType: 'image/webp' }) => Promise<Uint8Array>;
  now?: () => number;
  onMetrics?: (metrics: PlaceImageMetrics) => void;
  log?: (message: string, fields: PlaceImageMetrics) => void;
  decryptImageRequest?: (token: string) => unknown;
  semaphore?: { run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> };
}

const defaultTransform = async (bytes: Uint8Array) => new Uint8Array(await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 }).resize(864, 1536, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer());
const elapsed = (now: () => number, started: number) => Math.max(0, Math.round(now() - started));

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', aborted); resolve(); };
      const aborted = () => { const index = this.waiters.indexOf(ready); if (index >= 0) this.waiters.splice(index, 1); reject(signal?.reason ?? new Error('Place image generation aborted.')); };
      if (signal?.aborted) return aborted();
      signal?.addEventListener('abort', aborted, { once: true });
      this.waiters.push(ready);
    });
    this.active += 1;
    try { return await operation(); } finally { this.active -= 1; this.waiters.shift()?.(); }
  }
}
const placeImageSemaphore = new Semaphore(1);
type PlaceImageResult = {
  status: 'ready';
  images: [
    { role: 'hero'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
    { role: 'scene-1'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
    { role: 'scene-2'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
    { role: 'scene-3'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
  ];
  durationMs: number;
  costUsd: number | null;
};
const placeImageInFlight = new Map<string, Promise<PlaceImageResult>>();
const consumedPlaceImageTokens = new Map<string, number>();
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
function pruneReplayState(now: number) {
  for (const [hash, expiresAt] of consumedPlaceImageTokens) if (expiresAt <= now) consumedPlaceImageTokens.delete(hash);
}

export function resetPlaceImageReplayStateForTests() {
  placeImageInFlight.clear(); consumedPlaceImageTokens.clear();
}
export function placeImageReplayStateForTests() {
  return { inFlight: [...placeImageInFlight.keys()], consumed: [...consumedPlaceImageTokens.entries()] };
}

export function createPlaceImageGenerator(dependencies: PlaceImageDependencies) {
  const images = dependencies.images ?? imageGenerationService;
  const transform = dependencies.transform ?? defaultTransform;
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((message: string, fields: PlaceImageMetrics) => console.info(message, fields));
  const decryptImageRequest = dependencies.decryptImageRequest ?? decryptAuthenticatedJson;
  const semaphore = dependencies.semaphore ?? placeImageSemaphore;
  return async (raw: unknown, userKey: string, execution: { signal?: AbortSignal; timeoutMs?: number } = {}) => {
    const input = travelPlaceImagesInputSchema.parse(raw);
    const context: TravelAccessContext = { organizationKey: input.organizationKey, scopeKey: input.scopeKey, userKey };
    await dependencies.repository.authorizeRead(context);
    const token = placeImageTokenSchema.parse(decryptImageRequest(input.imageRequestToken));
    if (token.organizationKey !== input.organizationKey || token.scopeKey !== input.scopeKey) throw new Error('Place image request token does not match the authorized scope.');
    const currentTime = now();
    if (token.issuedAt > currentTime) throw new Error('Place image request token was issued in the future.');
    const expiresAt = token.issuedAt + PLACE_IMAGE_TOKEN_VALIDITY_MS;
    if (currentTime >= expiresAt) throw new Error('Place image request token has expired.');
    pruneReplayState(currentTime);
    const hash = tokenHash(input.imageRequestToken);
    const existing = placeImageInFlight.get(hash);
    if (existing) return existing;
    if (consumedPlaceImageTokens.has(hash)) throw new Error('Place image request token has already been used.');
    consumedPlaceImageTokens.set(hash, expiresAt);
    const { country, concepts } = token;
    const timeoutSignal = execution.timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, execution.timeoutMs));
    const signal = execution.signal && timeoutSignal ? AbortSignal.any([execution.signal, timeoutSignal]) : execution.signal ?? timeoutSignal;
    const started = currentTime;
    const promise = (async (): Promise<PlaceImageResult> => {
      try {
        return await semaphore.run(async () => {
        if (signal?.aborted) throw signal.reason ?? new Error('Place image generation aborted.');
        const generated = await Promise.all(concepts.map((concept) => images.generateRaw({ prompt: `Authoritative country: ${country.name} (${country.countryCode}), ${country.continent}. ${concept.prompt}`, count: 1, size: '1024x1536', quality: 'low' }, input.organizationKey, { signal, timeoutMs: execution.timeoutMs })));
        if (signal?.aborted) throw signal.reason ?? new Error('Place image generation aborted.');
        const cropStarted = now();
        const encoded = await Promise.all(generated.map(({ output }) => {
          const image = output.images[0];
          if (!image) throw new Error('Image provider returned no generated image.');
          return transform(new Uint8Array(Buffer.from(image.base64, 'base64')), { width: 864, height: 1536, mimeType: 'image/webp' });
        }));
        if (encoded.some((bytes) => bytes.byteLength > PLACE_IMAGE_WEBP_MAX_BYTES)) throw new Error('Transformed place image exceeds the maximum allowed size.');
        if (signal?.aborted) throw signal.reason ?? new Error('Place image generation aborted.');
        const cropMs = elapsed(now, cropStarted);
        const costs = generated.map(({ costUsd }) => costUsd);
        const costUsd = costs.every((cost): cost is number => typeof cost === 'number') ? costs.reduce((sum, cost) => sum + cost, 0) : null;
        const totalMs = elapsed(now, started);
        const result = {
          status: 'ready' as const,
          images: ROLES.map((role, index) => ({ role, status: 'ready' as const, title: concepts[index]!.title, url: `data:image/webp;base64,${Buffer.from(encoded[index]!).toString('base64')}`, width: 864 as const, height: 1536 as const, mimeType: 'image/webp' as const })) as [
            { role: 'hero'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
            { role: 'scene-1'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
            { role: 'scene-2'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
            { role: 'scene-3'; status: 'ready'; title: string; url: string; width: 864; height: 1536; mimeType: 'image/webp' },
          ],
          durationMs: totalMs,
          costUsd,
        };
        const metrics = { countryCode: country.countryCode, state: 'ready' as const, conceptTitles: concepts.map(({ title }) => title), providerDurationMs: generated.map(({ durationMs }) => durationMs), cropMs, totalMs, costUsd };
        dependencies.onMetrics?.(metrics); log('place image set generated', metrics);
        return result;
        }, signal);
      } catch (error) {
        const metrics = { countryCode: country.countryCode, state: 'failed' as const, conceptTitles: concepts.map(({ title }) => title), totalMs: elapsed(now, started) };
        dependencies.onMetrics?.(metrics); log('place image set generation failed', metrics);
        throw error;
      }
    })();
    placeImageInFlight.set(hash, promise);
    try { return await promise; } finally { if (placeImageInFlight.get(hash) === promise) placeImageInFlight.delete(hash); }
  };
}
