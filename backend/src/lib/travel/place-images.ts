import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { imageOutputSchema, type ImageOutput } from '@/lib/ai/providers';
import { placeCountryCodeSchema } from '@/lib/db/places.node';
import { decryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import type { TravelAccessContext, TravelRepository } from './repository';

export const PLACE_IMAGE_TOKEN_MAX_LENGTH = 64 * 1024;
export const PLACE_IMAGE_TOKEN_VALIDITY_MS = 60 * 60_000;
export const PLACE_IMAGE_WEBP_MAX_BYTES = 4 * 1024 * 1024;

export const travelPlaceImageInputSchema = z.object({
  organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), imageRequestToken: z.string().min(1).max(PLACE_IMAGE_TOKEN_MAX_LENGTH),
}).strict();
export const placeImageTokenSchema = z.object({
  version: z.literal(4), organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(),
  issuedAt: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  country: z.object({ name: z.string().trim().min(1).max(160), countryCode: placeCountryCodeSchema, continent: z.string().trim().min(1).max(80), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
  hero: z.object({ title: z.string().trim().min(1).max(160), prompt: z.string().trim().min(1).max(4_000) }).strict(),
  place: z.object({ name: z.string().trim().min(1).max(160), summary: z.string().trim().min(1), countryCode: placeCountryCodeSchema, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
}).strict();
export type PlaceImageToken = z.infer<typeof placeImageTokenSchema>;
export function stagedPlaceImageKey(nonce: string) { return `pending/gallery/place-media/${nonce}/preview.webp`; }
const inlineWebpSchema = z.string().max('data:image/webp;base64,'.length + Math.ceil(PLACE_IMAGE_WEBP_MAX_BYTES / 3) * 4).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);
export const travelPlaceImageResponseSchema = z.object({
  status: z.literal('ready'),
  image: z.object({ status: z.literal('ready'), title: z.string().trim().min(1).max(160), url: inlineWebpSchema, width: z.literal(1536), height: z.literal(864), mimeType: z.literal('image/webp') }).strict(),
  durationMs: z.number().int().nonnegative(), costUsd: z.number().nonnegative().nullable(),
}).strict();
export type PlaceImageResult = z.infer<typeof travelPlaceImageResponseSchema>;
export type PlaceImageMetrics = { countryCode: string; state: 'ready' | 'failed'; title: string; providerDurationMs?: number; transformMs?: number; totalMs: number; costUsd?: number | null };
export interface PlaceImageDependencies {
  repository: Pick<TravelRepository, 'authorizeRead'>;
  execute?: typeof executeAction;
  transform?: (bytes: Uint8Array) => Promise<Uint8Array>;
  now?: () => number;
  onMetrics?: (metrics: PlaceImageMetrics) => void;
  log?: (message: string, fields: PlaceImageMetrics) => void;
  decryptImageRequest?: (token: string) => unknown;
  storage?: DocumentObjectStorage;
}

const defaultTransform = async (bytes: Uint8Array) => new Uint8Array(await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 40_000_000 }).resize(1536, 864, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer());
const elapsed = (now: () => number, started: number) => Math.max(0, Math.round(now() - started));
const placeImageInFlight = new Map<string, Promise<PlaceImageResult>>();
const consumedPlaceImageTokens = new Map<string, number>();
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
function pruneReplayState(now: number) { for (const [hash, expiresAt] of consumedPlaceImageTokens) if (expiresAt <= now) consumedPlaceImageTokens.delete(hash); }
export function resetPlaceImageReplayStateForTests() { placeImageInFlight.clear(); consumedPlaceImageTokens.clear(); }
export function placeImageReplayStateForTests() { return { inFlight: [...placeImageInFlight.keys()], consumed: [...consumedPlaceImageTokens.entries()] }; }

export function createPlaceImageGenerator(dependencies: PlaceImageDependencies) {
  const execute = dependencies.execute ?? executeAction;
  const transform = dependencies.transform ?? defaultTransform;
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((message: string, fields: PlaceImageMetrics) => console.info(message, fields));
  const decryptImageRequest = dependencies.decryptImageRequest ?? decryptAuthenticatedJson;
  const storage = dependencies.storage ?? documentStorage;
  return async (raw: unknown, userKey: string, execution: Pick<ExecuteActionOptions, 'signal' | 'timeoutMs'> = {}) => {
    const input = travelPlaceImageInputSchema.parse(raw);
    const context: TravelAccessContext = { organizationKey: input.organizationKey, scopeKey: input.scopeKey, userKey };
    await dependencies.repository.authorizeRead(context);
    const token = placeImageTokenSchema.parse(decryptImageRequest(input.imageRequestToken));
    if (token.organizationKey !== input.organizationKey || token.scopeKey !== input.scopeKey) throw new Error('Place image request token does not match the authorized scope.');
    const currentTime = now();
    if (token.issuedAt > currentTime) throw new Error('Place image request token was issued in the future.');
    const expiresAt = token.issuedAt + PLACE_IMAGE_TOKEN_VALIDITY_MS;
    if (currentTime >= expiresAt) throw new Error('Place image request token has expired.');
    pruneReplayState(currentTime);
    const stagedKey = stagedPlaceImageKey(token.nonce);
    try {
      const staged = await storage.download(stagedKey);
      if (staged.bytes.byteLength > 0 && staged.bytes.byteLength <= PLACE_IMAGE_WEBP_MAX_BYTES) {
        consumedPlaceImageTokens.set(tokenHash(input.imageRequestToken), expiresAt);
        return travelPlaceImageResponseSchema.parse({ status: 'ready', image: { status: 'ready', title: token.hero.title, url: `data:image/webp;base64,${Buffer.from(staged.bytes).toString('base64')}`, width: 1536, height: 864, mimeType: 'image/webp' }, durationMs: 0, costUsd: null });
      }
    } catch {
      // A missing staged object is the only state that permits provider work.
    }
    const hash = tokenHash(input.imageRequestToken);
    const existing = placeImageInFlight.get(hash);
    if (existing) return existing;
    const started = currentTime;
    const promise = (async () => {
      try {
        const providerStarted = now();
        const response = await execute<Record<string, unknown>, ImageOutput>(
          { mode: 'fixed', organizationKey: input.organizationKey, actionSlug: 'generate-image', modelSlug: 'openai.gpt-image-2', providerSlug: 'openai' },
          { prompt: token.hero.prompt, count: 1, size: '1536x1024', quality: 'low' },
          { signal: execution.signal, timeoutMs: execution.timeoutMs ?? 60_000 },
        );
        const providerDurationMs = elapsed(now, providerStarted);
        const output = imageOutputSchema.parse(response.output);
        if (output.images.length !== 1) throw new Error(`Image provider returned ${output.images.length} images; expected one.`);
        const transformStarted = now();
        const encoded = await transform(new Uint8Array(Buffer.from(output.images[0]!.base64, 'base64')));
        if (encoded.byteLength > PLACE_IMAGE_WEBP_MAX_BYTES) throw new Error('Prepared place image exceeds the maximum allowed size.');
        await storage.upload({ key: stagedKey, bytes: encoded, mimeType: 'image/webp' });
        const transformMs = elapsed(now, transformStarted);
        const result = travelPlaceImageResponseSchema.parse({
          status: 'ready', image: { status: 'ready', title: token.hero.title, url: `data:image/webp;base64,${Buffer.from(encoded).toString('base64')}`, width: 1536, height: 864, mimeType: 'image/webp' },
          durationMs: elapsed(now, started), costUsd: response.costUsd ?? null,
        });
        const metrics = { countryCode: token.country.countryCode, state: 'ready' as const, title: token.hero.title, providerDurationMs, transformMs, totalMs: result.durationMs, costUsd: result.costUsd };
        dependencies.onMetrics?.(metrics); log('place hero generated', metrics); consumedPlaceImageTokens.set(hash, expiresAt);
        return result;
      } catch (error) {
        const metrics = { countryCode: token.country.countryCode, state: 'failed' as const, title: token.hero.title, totalMs: elapsed(now, started) };
        dependencies.onMetrics?.(metrics); log('place hero generation failed', metrics); throw error;
      }
    })();
    placeImageInFlight.set(hash, promise);
    try { return await promise; } finally { if (placeImageInFlight.get(hash) === promise) placeImageInFlight.delete(hash); }
  };
}
