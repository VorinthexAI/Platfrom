import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { GalleryImageInputError, sanitizeGalleryImage } from '@/lib/gallery/image-location';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { acknowledgeStorageUploadReservation, isStorageKeyReferenced, releaseStorageUploadReservation, reserveStorageKeyForUpload, type StorageUploadReservation } from '@/lib/db/storage-deletion-jobs.node';
import { assertStorageGrowthAllowed, StorageUnfundedError } from '@/lib/automations/storage-charger-repository';
import { accountProfileService, type AccountProfileService } from './service';

export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_AVATAR_URL_TTL_SECONDS = 10 * 60;
export const PROFILE_AVATAR_MAX_EDGE = 512;

const userKeySchema = z.string().cuid();
const mimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const filenameSchema = z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Filename is invalid.');
export const profileAvatarReserveInputSchema = z.object({
  filename: filenameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: z.number().int().positive().max(PROFILE_AVATAR_MAX_BYTES),
}).strict().superRefine((input, context) => {
  const extension = input.filename.split('.').at(-1)?.toLowerCase();
  const matches = input.mimeType === 'image/jpeg' ? extension === 'jpg' || extension === 'jpeg'
    : input.mimeType === 'image/png' ? extension === 'png'
      : extension === 'webp';
  if (!matches) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Filename extension and MIME type must match.', path: ['mimeType'] });
});
export const profileAvatarCompleteInputSchema = z.object({ uploadKey: z.string().cuid() }).strict();

export const profileAvatarReservationSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  filename: filenameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: z.number().int().positive().max(PROFILE_AVATAR_MAX_BYTES),
  storageKey: z.string().min(1),
  status: z.enum(['reserved', 'processing']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
export type ProfileAvatarReservation = z.infer<typeof profileAvatarReservationSchema>;

type RedisLike = Pick<typeof redisConnection, 'get' | 'set' | 'del' | 'eval'>;
type Transition = (record: ProfileAvatarReservation, next: ProfileAvatarReservation, ttlSeconds: number) => Promise<boolean>;
const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;
const redisKey = (uploadKey: string) => `profile-avatar-upload:${uploadKey}`;
const extensionFor = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const formatFor = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

const TRANSITION_SCRIPT = `
local raw = redis.call('get', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= ARGV[1] or current.userKey ~= ARGV[2] then return 0 end
redis.call('set', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1`;

export interface ProfileAvatarUploadDependencies {
  redis?: RedisLike;
  storage?: DocumentObjectStorage;
  profileService?: Pick<AccountProfileService, 'replaceAvatar'>;
  signUpload?: (record: ProfileAvatarReservation) => Promise<string>;
  inspectObject?: (storageKey: string) => Promise<{ sizeBytes?: number; mimeType?: string }>;
  sanitizeImage?: typeof sanitizeGalleryImage;
  transition?: Transition;
  reserveStorageKey?: (storageKey: string) => Promise<StorageUploadReservation | null>;
  acknowledgeStorageReservation?: (reservation: StorageUploadReservation) => Promise<boolean>;
  releaseStorageReservation?: (reservation: StorageUploadReservation) => Promise<boolean>;
  isStorageReferenced?: (storageKey: string) => Promise<boolean>;
  now?: () => Date;
  id?: () => string;
}

export class ProfileAvatarUploadError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 500, readonly code: string, message: string) {
    super(message);
    this.name = 'ProfileAvatarUploadError';
  }
}

export function normalizeProfileAvatarUploadError(error: unknown) {
  if (error instanceof ProfileAvatarUploadError) return error;
  if (error instanceof StorageUnfundedError) return new ProfileAvatarUploadError(409, error.code, error.message);
  if (error instanceof GalleryImageInputError) return new ProfileAvatarUploadError(400, 'PROFILE_AVATAR_INVALID_IMAGE', error.message);
  if (error instanceof ZodError || error instanceof SyntaxError) return new ProfileAvatarUploadError(400, 'PROFILE_AVATAR_INVALID_INPUT', 'Avatar upload input was invalid.');
  return new ProfileAvatarUploadError(500, 'PROFILE_AVATAR_FAILED', 'Avatar upload failed.');
}

async function transition(record: ProfileAvatarReservation, next: ProfileAvatarReservation, ttlSeconds: number, dependencies: ProfileAvatarUploadDependencies) {
  if (dependencies.transition) return dependencies.transition(record, next, ttlSeconds);
  return Number(await (dependencies.redis ?? redisConnection).eval(TRANSITION_SCRIPT, 1, redisKey(record.key), record.status, record.userKey, JSON.stringify(next), String(ttlSeconds))) === 1;
}

export async function reserveProfileAvatarUpload(rawInput: unknown, authenticatedUserKey: string, dependencies: ProfileAvatarUploadDependencies = {}) {
  const userKey = userKeySchema.parse(authenticatedUserKey);
  const input = profileAvatarReserveInputSchema.parse(rawInput);
  const now = dependencies.now?.() ?? new Date();
  const key = (dependencies.id ?? newId)();
  const expiresAt = new Date(now.getTime() + PROFILE_AVATAR_URL_TTL_SECONDS * 1_000).toISOString();
  const record = profileAvatarReservationSchema.parse({
    key,
    userKey,
    ...input,
    storageKey: `pending/profile-avatars/${userKey}/${key}/original.${extensionFor[input.mimeType]}`,
    status: 'reserved',
    createdAt: now.toISOString(),
    expiresAt,
  });
  const redis = dependencies.redis ?? redisConnection;
  if (await redis.set(redisKey(key), JSON.stringify(record), 'EX', PROFILE_AVATAR_URL_TTL_SECONDS, 'NX') !== 'OK') throw new Error('Avatar reservation key collision.');
  try {
    if (!dependencies.signUpload) await assertStorageGrowthAllowed(userKey);
    const url = await (dependencies.signUpload ?? ((value) => signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: value.storageKey, ContentType: value.mimeType }), { expiresIn: PROFILE_AVATAR_URL_TTL_SECONDS })))(record);
    return { uploadKey: key, url, headers: { 'Content-Type': record.mimeType }, expiresAt };
  } catch (error) {
    await redis.del(redisKey(key));
    throw error;
  }
}

export async function completeProfileAvatarUpload(rawInput: unknown, authenticatedUserKey: string, dependencies: ProfileAvatarUploadDependencies = {}) {
  const userKey = userKeySchema.parse(authenticatedUserKey);
  const input = profileAvatarCompleteInputSchema.parse(rawInput);
  const redis = dependencies.redis ?? redisConnection;
  const raw = await redis.get(redisKey(input.uploadKey));
  const record = raw ? profileAvatarReservationSchema.parse(JSON.parse(raw)) : null;
  if (!record || record.userKey !== userKey) throw new ProfileAvatarUploadError(404, 'PROFILE_AVATAR_UPLOAD_NOT_FOUND', 'Avatar upload reservation not found.');
  const now = dependencies.now?.() ?? new Date();
  if (record.status !== 'reserved' || Date.parse(record.expiresAt) <= now.getTime()) throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_CHANGED', 'Avatar upload reservation is expired or no longer pending.');
  const ttl = Math.max(1, Math.ceil((Date.parse(record.expiresAt) - now.getTime()) / 1_000));
  const processing = profileAvatarReservationSchema.parse({ ...record, status: 'processing' });
  if (!await transition(record, processing, ttl, dependencies)) throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_CHANGED', 'Avatar upload reservation changed before processing.');

  const storage = dependencies.storage ?? documentStorage;
  const canonicalStorageKey = `profiles/${userKey}/${record.key}.png`;
  const customReservation = { storageKey: canonicalStorageKey, token: 'custom-storage' };
  const reserveStorageKey = dependencies.reserveStorageKey ?? (dependencies.storage ? async () => customReservation : reserveStorageKeyForUpload);
  const acknowledgeReservation = dependencies.acknowledgeStorageReservation ?? (dependencies.storage ? async () => true : acknowledgeStorageUploadReservation);
  const releaseReservation = dependencies.releaseStorageReservation ?? (dependencies.storage ? async () => true : releaseStorageUploadReservation);
  const storageReferenced = dependencies.isStorageReferenced ?? (dependencies.storage ? async () => false : isStorageKeyReferenced);
  let reservation: StorageUploadReservation | null = null;
  let canonicalStored = false;
  let canonicalReferenced = false;
  try {
    reservation = await reserveStorageKey(canonicalStorageKey);
    if (!reservation) throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_CHANGED', 'Avatar storage is already being reconciled.');
    const inspected = dependencies.inspectObject
      ? await dependencies.inspectObject(record.storageKey)
      : await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: record.storageKey })).then((head) => ({ sizeBytes: head.ContentLength, mimeType: head.ContentType }));
    if (inspected.sizeBytes !== record.sizeBytes || inspected.mimeType?.toLowerCase() !== record.mimeType) throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_MISMATCH', 'Uploaded avatar does not match its reservation.');
    const object = await storage.download(record.storageKey);
    if (object.bytes.byteLength !== record.sizeBytes || object.bytes.byteLength > PROFILE_AVATAR_MAX_BYTES || object.sizeBytes !== undefined && object.sizeBytes !== record.sizeBytes || object.mimeType !== undefined && object.mimeType.toLowerCase() !== record.mimeType) {
      throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_MISMATCH', 'Uploaded avatar does not match its reservation.');
    }
    const sourceMetadata = await sharp(object.bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
    if (sourceMetadata.format !== formatFor[record.mimeType]) throw new ProfileAvatarUploadError(409, 'PROFILE_AVATAR_UPLOAD_MISMATCH', 'Uploaded avatar bytes do not match the reserved image type.');
    const sanitized = await (dependencies.sanitizeImage ?? sanitizeGalleryImage)(object.bytes);
    const canonical = new Uint8Array(await sharp(sanitized.bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 })
      .resize({ width: PROFILE_AVATAR_MAX_EDGE, height: PROFILE_AVATAR_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer());
    const metadata = await sharp(canonical).metadata();
    if (!metadata.width || !metadata.height || metadata.width > PROFILE_AVATAR_MAX_EDGE || metadata.height > PROFILE_AVATAR_MAX_EDGE) throw new ProfileAvatarUploadError(400, 'PROFILE_AVATAR_INVALID_IMAGE', 'Canonical avatar dimensions are invalid.');
    await storage.upload({ key: canonicalStorageKey, bytes: canonical, mimeType: 'image/png', billingUserKey: userKey });
    canonicalStored = true;
    const result = await (dependencies.profileService ?? accountProfileService).replaceAvatar({ storageKey: canonicalStorageKey }, userKey);
    canonicalReferenced = true;
    if (!await acknowledgeReservation(reservation)) throw new Error('Profile avatar storage reservation acknowledgement fence was lost.');
    await Promise.all([storage.delete(record.storageKey).catch(() => undefined), redis.del(redisKey(record.key)).catch(() => undefined)]);
    return { ...result, avatar: { mimeType: 'image/png' as const, sizeBytes: canonical.byteLength, width: metadata.width, height: metadata.height } };
  } catch (error) {
    if (canonicalStored && !canonicalReferenced) {
      try { canonicalReferenced = await storageReferenced(canonicalStorageKey); } catch { canonicalReferenced = true; }
    }
    await Promise.all([
      storage.delete(record.storageKey).catch(() => undefined),
      canonicalStored && !canonicalReferenced ? storage.delete(canonicalStorageKey).catch(() => undefined) : Promise.resolve(),
      reservation ? canonicalReferenced ? acknowledgeReservation(reservation).catch(() => false) : releaseReservation(reservation).catch(() => false) : Promise.resolve(false),
      redis.del(redisKey(record.key)).catch(() => undefined),
    ]);
    throw error;
  }
}
