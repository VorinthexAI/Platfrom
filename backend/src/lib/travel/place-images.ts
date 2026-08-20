import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { z } from 'zod';
import sharp from 'sharp';
import { placeCountryCodeSchema } from '@/lib/db/places.node';
import { decryptAuthenticatedJson } from '@/lib/authenticated-encryption';
import type { TravelAccessContext, TravelRepository } from './repository';

const ROLES = ['hero', 'scene-1', 'scene-2', 'scene-3'] as const;
export const PLACE_IMAGE_TOKEN_MAX_LENGTH = 64 * 1024;
export const PLACE_IMAGE_TOKEN_VALIDITY_MS = 60 * 60_000;
export const PLACE_IMAGE_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const PLACE_IMAGE_WEBP_MAX_BYTES = 4 * 1024 * 1024;
const PLACE_IMAGE_FETCH_TIMEOUT_MS = 15_000;

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
const httpsUrlSchema = z.string().url().max(8_000).refine((value) => new URL(value).protocol === 'https:', 'Place image URLs must use HTTPS');
const placeImageSchema = z.object({
  role: z.enum(ROLES), title: z.string().trim().min(1).max(160), url: httpsUrlSchema, sourcePageUrl: httpsUrlSchema,
}).strict();
const placeImageTokenSchema = z.object({
  version: z.literal(2), organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(),
  issuedAt: z.number().int().nonnegative(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  country: z.object({ name: z.string().trim().min(1).max(160), countryCode: placeCountryCodeSchema, continent: z.string().trim().min(1).max(80), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict(),
  images: z.array(placeImageSchema).min(1).max(4).superRefine((images, context) => {
    images.forEach((image, index) => { if (image.role !== ROLES[index]) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'role'], message: `Place image ${index + 1} must have role ${ROLES[index]}.` }); });
  }),
}).strict();

export type PlaceImageMetrics = { countryCode: string; state: 'ready' | 'failed'; imageTitles: string[]; totalMs: number };
export interface PlaceImageDependencies {
  repository: Pick<TravelRepository, 'authorizeRead'>;
  now?: () => number;
  onMetrics?: (metrics: PlaceImageMetrics) => void;
  log?: (message: string, fields: PlaceImageMetrics) => void;
  decryptImageRequest?: (token: string) => unknown;
  prepareImage?: (url: string, signal?: AbortSignal) => Promise<string>;
}

const elapsed = (now: () => number, started: number) => Math.max(0, Math.round(now() - started));
function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || a! >= 224);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
  return normalized !== '::' && normalized !== '::1' && !normalized.startsWith('fc') && !normalized.startsWith('fd') && !/^fe[89ab]/.test(normalized) && !normalized.startsWith('ff');
}
async function resolvePublicImageUrl(url: URL) {
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Place image source must be an unauthenticated HTTPS URL.');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Place image source resolved to a non-public address.');
  return addresses[0]!;
}
async function readBoundedBody(response: IncomingMessage) {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > PLACE_IMAGE_SOURCE_MAX_BYTES) throw new Error('Place image source exceeds the maximum allowed size.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const value of response) {
    const chunk = new Uint8Array(value);
    size += chunk.byteLength;
    if (size > PLACE_IMAGE_SOURCE_MAX_BYTES) { response.destroy(); throw new Error('Place image source exceeds the maximum allowed size.'); }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function requestPinnedImage(url: URL, signal: AbortSignal) {
  const resolved = await resolvePublicImageUrl(url);
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET', signal, servername: url.hostname,
      headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png' },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [resolved]);
        else callback(null, resolved.address, resolved.family);
      },
    }, resolve);
    request.on('error', reject);
    request.end();
  });
}
async function defaultPrepareImage(rawUrl: string, signal?: AbortSignal) {
  let url = new URL(rawUrl);
  const timeoutSignal = AbortSignal.timeout(PLACE_IMAGE_FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: IncomingMessage | undefined;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await requestPinnedImage(url, requestSignal);
    if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) break;
    const location = response.headers.location;
    response.resume();
    if (!location || redirects === 3) throw new Error('Place image source exceeded the redirect limit.');
    url = new URL(location, url);
  }
  if (!response || (response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) { response?.resume(); throw new Error(`Place image source returned HTTP ${response?.statusCode ?? 0}.`); }
  if (!(response.headers['content-type'] ?? '').toLowerCase().startsWith('image/')) { response.resume(); throw new Error('Place image source did not return image content.'); }
  const source = await readBoundedBody(response);
  const output = new Uint8Array(await sharp(source, { animated: false, failOn: 'error', limitInputPixels: 40_000_000 }).resize(864, 1536, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer());
  if (output.byteLength > PLACE_IMAGE_WEBP_MAX_BYTES) throw new Error('Prepared place image exceeds the maximum allowed size.');
  return `data:image/webp;base64,${Buffer.from(output).toString('base64')}`;
}
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal) {
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', aborted); resolve(); };
      const aborted = () => { const index = this.waiters.indexOf(ready); if (index >= 0) this.waiters.splice(index, 1); reject(signal?.reason ?? new Error('Place image preparation aborted.')); };
      if (signal?.aborted) return aborted();
      signal?.addEventListener('abort', aborted, { once: true }); this.waiters.push(ready);
    });
    this.active += 1;
    try { return await operation(); } finally { this.active -= 1; this.waiters.shift()?.(); }
  }
}
const placeImagePreparationSemaphore = new Semaphore(4);
type PlaceImageResult = {
  status: 'ready';
  images: Array<{ role: typeof ROLES[number]; status: 'ready'; title: string; url: string; sourcePageUrl: string }>;
  durationMs: number;
  costUsd: 0;
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
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((message: string, fields: PlaceImageMetrics) => console.info(message, fields));
  const decryptImageRequest = dependencies.decryptImageRequest ?? decryptAuthenticatedJson;
  const prepareImage = dependencies.prepareImage ?? defaultPrepareImage;
  return async (raw: unknown, userKey: string, execution: { signal?: AbortSignal } = {}) => {
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
    const started = currentTime;
    const promise = (async (): Promise<PlaceImageResult> => {
      try {
        if (execution.signal?.aborted) throw execution.signal.reason ?? new Error('Place image lookup aborted.');
        const controller = new AbortController();
        const preparationSignal = execution.signal ? AbortSignal.any([execution.signal, controller.signal]) : controller.signal;
        const prepared = await Promise.allSettled(token.images.map(({ url }) => placeImagePreparationSemaphore.run(() => prepareImage(url, preparationSignal), preparationSignal)));
        if (execution.signal?.aborted) throw execution.signal.reason ?? new Error('Place image lookup aborted.');
        const available = prepared.flatMap((entry, index) => entry.status === 'fulfilled' ? [{ image: token.images[index]!, url: entry.value }] : []);
        if (available.length === 0) {
          controller.abort();
          const reasons = [...new Set(prepared.flatMap((entry) => entry.status === 'rejected' && entry.reason instanceof Error ? [entry.reason.message] : []))];
          throw new Error(`No web image could be prepared safely${reasons.length > 0 ? `: ${reasons.join('; ')}` : '.'}`);
        }
        const result = {
          status: 'ready' as const,
          images: available.map(({ image, url }, index) => ({ ...image, role: ROLES[index]!, url, status: 'ready' as const })),
          durationMs: elapsed(now, started),
          costUsd: 0 as const,
        };
        const metrics = { countryCode: token.country.countryCode, state: 'ready' as const, imageTitles: token.images.map(({ title }) => title), totalMs: result.durationMs };
        dependencies.onMetrics?.(metrics); log('place web images released', metrics);
        consumedPlaceImageTokens.set(hash, expiresAt);
        return result;
      } catch (error) {
        const metrics = { countryCode: token.country.countryCode, state: 'failed' as const, imageTitles: token.images.map(({ title }) => title), totalMs: elapsed(now, started) };
        dependencies.onMetrics?.(metrics); log('place web image release failed', metrics);
        throw error;
      }
    })();
    placeImageInFlight.set(hash, promise);
    try { return await promise; } finally { if (placeImageInFlight.get(hash) === promise) placeImageInFlight.delete(hash); }
  };
}
