import { createHash } from 'node:crypto';
import { z } from 'zod';
import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { imageOutputSchema, type ImageOutput } from '@/lib/ai/providers';
import { GENERATED_IMAGE_BASE64_MAX_LENGTH } from '@/lib/ai/providers/types';
import { placeCountryCodeSchema } from '@/lib/db/places.node';
import { decryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import type { TravelAccessContext, TravelRepository } from './repository';

export const PLACE_IMAGE_TOKEN_MAX_LENGTH = 64 * 1024;
export const PLACE_IMAGE_TOKEN_VALIDITY_MS = 60 * 60_000;
export const PLACE_IMAGE_PNG_MAX_BYTES = Math.floor(GENERATED_IMAGE_BASE64_MAX_LENGTH / 4) * 3;

export const travelPlaceImageInputSchema = z.object({
  organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), imageRequestToken: z.string().min(1).max(PLACE_IMAGE_TOKEN_MAX_LENGTH),
}).strict();
export const placeImageTokenSchema = z.object({
  version: z.literal(5), organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(),
  issuedAt: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  country: z.object({ name: z.string().trim().min(1).max(160), countryCode: placeCountryCodeSchema, continent: z.string().trim().min(1).max(80), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
  hero: z.object({ title: z.string().trim().min(1).max(160), prompt: z.string().trim().min(1).max(4_000) }).strict(),
  place: z.object({ kind: z.enum(['country', 'place']), name: z.string().trim().min(1).max(160), summary: z.string().trim().min(1), countryCode: placeCountryCodeSchema, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
}).strict();
export type PlaceImageToken = z.infer<typeof placeImageTokenSchema>;
export function stagedPlaceImageKey(nonce: string) { return `pending/gallery/place-media/${nonce}/preview.png`; }
const inlinePngSchema = z.string().max('data:image/png;base64,'.length + GENERATED_IMAGE_BASE64_MAX_LENGTH).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export const travelPlaceImageResponseSchema = z.object({
  status: z.literal('ready'),
  image: z.object({ status: z.literal('ready'), title: z.string().trim().min(1).max(160), url: inlinePngSchema, width: z.literal(1536), height: z.literal(1024), mimeType: z.literal('image/png') }).strict(),
  durationMs: z.number().int().nonnegative(), costUsd: z.number().nonnegative().nullable(),
}).strict();
export type PlaceImageResult = z.infer<typeof travelPlaceImageResponseSchema>;
export type PlaceImageMetrics = { countryCode: string; state: 'ready' | 'failed'; title: string; providerDurationMs?: number; stagingMs?: number; totalMs: number; costUsd?: number | null };
export interface PlaceImageDependencies {
  repository: Pick<TravelRepository, 'authorizeRead'>;
  execute?: typeof executeAction;
  now?: () => number;
  onMetrics?: (metrics: PlaceImageMetrics) => void;
  log?: (message: string, fields: PlaceImageMetrics) => void;
  decryptImageRequest?: (token: string) => unknown;
  storage?: DocumentObjectStorage;
}

const elapsed = (now: () => number, started: number) => Math.max(0, Math.round(now() - started));
const placeImageInFlight = new Map<string, Promise<PlaceImageResult>>();
const consumedPlaceImageTokens = new Map<string, number>();
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
function assertPlacePngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 24 || signature.some((value, index) => bytes[index] !== value)) throw new Error('Image provider returned invalid PNG bytes.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== 1536 || height !== 1024) throw new Error(`Image provider returned ${width}x${height}; expected 1536x1024.`);
}
function pruneReplayState(now: number) { for (const [hash, expiresAt] of consumedPlaceImageTokens) if (expiresAt <= now) consumedPlaceImageTokens.delete(hash); }
export function resetPlaceImageReplayStateForTests() { placeImageInFlight.clear(); consumedPlaceImageTokens.clear(); }
export function placeImageReplayStateForTests() { return { inFlight: [...placeImageInFlight.keys()], consumed: [...consumedPlaceImageTokens.entries()] }; }

export function createPlaceImageGenerator(dependencies: PlaceImageDependencies) {
  const execute = dependencies.execute ?? executeAction;
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
      if (staged.bytes.byteLength > 0 && staged.bytes.byteLength <= PLACE_IMAGE_PNG_MAX_BYTES) {
        assertPlacePngDimensions(staged.bytes);
        consumedPlaceImageTokens.set(tokenHash(input.imageRequestToken), expiresAt);
        return travelPlaceImageResponseSchema.parse({ status: 'ready', image: { status: 'ready', title: token.hero.title, url: `data:image/png;base64,${Buffer.from(staged.bytes).toString('base64')}`, width: 1536, height: 1024, mimeType: 'image/png' }, durationMs: 0, costUsd: null });
      }
    } catch {
      // A missing staged object is the only state that permits provider work.
    }
    const hash = tokenHash(input.imageRequestToken);
    const inFlightKey = `${token.organizationKey}\0${token.scopeKey}\0${token.nonce}`;
    const existing = placeImageInFlight.get(inFlightKey);
    if (existing) return existing;
    const started = currentTime;
    const promise = (async () => {
      try {
        const providerStarted = now();
        const response = await execute<Record<string, unknown>, ImageOutput>(
          { mode: 'auto', organizationKey: input.organizationKey, actionSlug: 'generate-image' },
          { prompt: token.hero.prompt, count: 1, size: '1536x1024', aspectRatio: '3:2', quality: 'low', outputFormat: 'png' },
          { signal: execution.signal, timeoutMs: execution.timeoutMs ?? 60_000 },
        );
        const providerDurationMs = elapsed(now, providerStarted);
        const output = imageOutputSchema.parse(response.output);
        if (output.images.length !== 1) throw new Error(`Image provider returned ${output.images.length} images; expected one.`);
        if (output.images[0]!.mimeType !== 'image/png') throw new Error(`Image provider returned ${output.images[0]!.mimeType}; expected image/png.`);
        const encoded = new Uint8Array(Buffer.from(output.images[0]!.base64, 'base64'));
        if (encoded.byteLength > PLACE_IMAGE_PNG_MAX_BYTES) throw new Error('Generated place PNG exceeds the maximum allowed size.');
        assertPlacePngDimensions(encoded);
        const stagingStarted = now();
        await storage.upload({ key: stagedKey, bytes: encoded, mimeType: 'image/png' });
        const stagingMs = elapsed(now, stagingStarted);
        const result = travelPlaceImageResponseSchema.parse({
          status: 'ready', image: { status: 'ready', title: token.hero.title, url: `data:image/png;base64,${Buffer.from(encoded).toString('base64')}`, width: 1536, height: 1024, mimeType: 'image/png' },
          durationMs: elapsed(now, started), costUsd: response.costUsd ?? null,
        });
        const metrics = { countryCode: token.country.countryCode, state: 'ready' as const, title: token.hero.title, providerDurationMs, stagingMs, totalMs: result.durationMs, costUsd: result.costUsd };
        dependencies.onMetrics?.(metrics); log('place hero generated', metrics); consumedPlaceImageTokens.set(hash, expiresAt);
        return result;
      } catch (error) {
        const metrics = { countryCode: token.country.countryCode, state: 'failed' as const, title: token.hero.title, totalMs: elapsed(now, started) };
        dependencies.onMetrics?.(metrics); log('place hero generation failed', metrics); throw error;
      }
    })();
    placeImageInFlight.set(inFlightKey, promise);
    try { return await promise; } finally { if (placeImageInFlight.get(inFlightKey) === promise) placeImageInFlight.delete(inFlightKey); }
  };
}
