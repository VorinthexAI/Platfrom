import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { documentStorage, type DocumentObjectStorage } from './storage';
import { DEFAULT_MAX_DOCUMENT_BYTES, positiveDocumentLimit } from './actions';
import { MAX_DOCUMENT_SCAN_PAGE_BYTES, MAX_DOCUMENT_SCAN_PAGES } from './schemas';
import { authorizeDocumentParseLocation } from '@/lib/ai/tools/content-runtime';
import { runAuthenticatedContentTool, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools/content-run';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { ContentError } from '@/lib/ai/tools/content-errors';

const key = z.string().cuid();
const file = z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }).strict();
export const documentUploadReserveSchema = z.object({ teamKey: z.string().trim().min(1), scopeKey: key, folderKey: key.optional(), name: z.string().trim().min(1).max(255).optional(), idempotencyKey: z.string().trim().min(1).max(200), files: z.array(file).min(1).max(MAX_DOCUMENT_SCAN_PAGES), kind: z.enum(['file', 'pages']) }).strict();
export const documentUploadCompleteSchema = z.object({ teamKey: z.string().trim().min(1), scopeKey: key, uploadKey: key, idempotencyKey: z.string().trim().min(1).max(200) }).strict();
type ReserveInput = z.infer<typeof documentUploadReserveSchema>;
type CompleteInput = z.infer<typeof documentUploadCompleteSchema>;
const reservationSchema = documentUploadReserveSchema.extend({ uploadKey: key, userKey: key, storageKeys: z.array(z.string().min(1)), expiresAt: z.string().datetime(), status: z.enum(['reserved', 'completed']), result: z.unknown().optional() }).strict();
type Reservation = z.infer<typeof reservationSchema>;

const URL_TTL = 10 * 60;
const RESERVATION_TTL = 24 * 60 * 60;
const LOCK_TTL = 30 * 60;
const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;

export class DocumentUploadError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string, message: string) { super(message); }
}

export interface DocumentUploadDependencies {
  redis?: Pick<typeof redisConnection, 'get' | 'set' | 'eval'>;
  storage?: DocumentObjectStorage;
  signUpload?: (storageKey: string, mimeType: string) => Promise<string>;
  inspect?: (storageKey: string) => Promise<{ sizeBytes?: number; mimeType?: string }>;
  preflight?: typeof authorizeDocumentParseLocation;
  run?: typeof runAuthenticatedContentTool;
  now?: () => Date;
}

function recordKey(uploadKey: string) { return `document-upload:${uploadKey}`; }
function requestKey(input: ReserveInput, userKey: string) {
  return `document-upload-request:${createHash('sha256').update(JSON.stringify([userKey, input.teamKey, input.scopeKey, input.idempotencyKey])).digest('hex')}`;
}
function owner(context: ToolContext) {
  if (context.principal.kind !== 'member' || context.principal.userTeam.status !== 'active') throw new ContentError('CONTENT_FORBIDDEN', 'Active membership is required.', 'document.parse', { action: 'authorization' });
  return context.principal.user.key;
}
function assertBound(record: Reservation | null, input: CompleteInput, context: ToolContext) {
  if (!record || record.userKey !== owner(context) || record.teamKey !== context.teamKey || record.teamKey !== input.teamKey || record.scopeKey !== context.runtimeScopeKey || record.scopeKey !== input.scopeKey || record.uploadKey !== input.uploadKey || record.idempotencyKey !== input.idempotencyKey) {
    throw new DocumentUploadError(404, 'DOCUMENT_UPLOAD_NOT_FOUND', 'Upload reservation was not found.');
  }
}
function checkLimits(input: ReserveInput) {
  const max = positiveDocumentLimit(process.env.CONTENT_MAX_DOCUMENT_BYTES, DEFAULT_MAX_DOCUMENT_BYTES);
  if (input.kind === 'file' && (input.files.length !== 1 || input.files[0]!.sizeBytes > max || input.files[0]!.sizeBytes <= 0)) throw new DocumentUploadError(400, 'DOCUMENT_TOO_LARGE', 'The document exceeds the supported upload limit.');
  if (input.kind === 'pages' && (input.files.some(({ sizeBytes, mimeType }) => sizeBytes > MAX_DOCUMENT_SCAN_PAGE_BYTES || !['image/jpeg', 'image/png'].includes(mimeType)) || input.files.reduce((sum, item) => sum + item.sizeBytes, 0) > 2 * MAX_DOCUMENT_SCAN_PAGE_BYTES)) throw new DocumentUploadError(400, 'DOCUMENT_TOO_LARGE', 'The scan exceeds the supported page or session limit.');
}

export async function reserveDocumentUpload(raw: unknown, context: ToolContext, dependencies: DocumentUploadDependencies = {}) {
  const input = documentUploadReserveSchema.parse(raw);
  const userKey = owner(context);
  if (input.teamKey !== context.teamKey || input.scopeKey !== context.runtimeScopeKey) throw new ContentError('CONTENT_FORBIDDEN', 'Upload scope is not authorized.', 'document.parse', { action: 'authorization' });
  checkLimits(input);
  await (dependencies.preflight ?? authorizeDocumentParseLocation)(input, context);
  const redis = dependencies.redis ?? redisConnection;
  const binding = requestKey(input, userKey);
  const existingKey = await redis.get(binding);
  let record: Reservation;
  if (existingKey) {
    const saved = await redis.get(recordKey(existingKey));
    if (!saved) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_CHANGED', 'Upload reservation expired.');
    record = reservationSchema.parse(JSON.parse(saved));
    if (record.userKey !== userKey || JSON.stringify(record.files) !== JSON.stringify(input.files) || record.folderKey !== input.folderKey || record.kind !== input.kind || record.name !== input.name || record.status !== 'reserved' || Date.parse(record.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_CHANGED', 'Upload reservation changed.');
  } else {
    const uploadKey = newId();
    const now = dependencies.now?.() ?? new Date();
    record = reservationSchema.parse({ ...input, uploadKey, userKey, storageKeys: input.files.map((_, index) => `pending/content/${input.scopeKey}/${uploadKey}/${index}`), status: 'reserved', expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() });
    if (await redis.set(recordKey(uploadKey), JSON.stringify(record), 'EX', RESERVATION_TTL, 'NX') !== 'OK') throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_CHANGED', 'Upload reservation collision.');
    if (await redis.set(binding, uploadKey, 'EX', RESERVATION_TTL, 'NX') !== 'OK') {
      // A concurrent reservation won; the losing staging key has never been signed.
      return reserveDocumentUpload(input, context, dependencies);
    }
  }
  const sign = dependencies.signUpload ?? ((storageKey: string, mimeType: string) => signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: storageKey, ContentType: mimeType }), { expiresIn: URL_TTL }));
  const urls = await Promise.all(record.files.map((item, index) => sign(record.storageKeys[index]!, item.mimeType)));
  return { uploadKey: record.uploadKey, uploads: urls.map((url, index) => ({ url, headers: { 'Content-Type': record.files[index]!.mimeType } })) };
}

const unlockScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export async function completeDocumentUpload(raw: unknown, context: ToolContext, options: RunAuthenticatedContentToolOptions, dependencies: DocumentUploadDependencies = {}) {
  const input = documentUploadCompleteSchema.parse(raw);
  const redis = dependencies.redis ?? redisConnection;
  const rawRecord = await redis.get(recordKey(input.uploadKey));
  const record = rawRecord ? reservationSchema.parse(JSON.parse(rawRecord)) : null;
  assertBound(record, input, context);
  await (dependencies.preflight ?? authorizeDocumentParseLocation)(record!, context);
  if (record!.status === 'completed') return record!.result;
  if (Date.parse(record!.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_EXPIRED', 'Upload reservation expired.');
  const lockKey = `${recordKey(input.uploadKey)}:lock`;
  const token = newId();
  if (await redis.set(lockKey, token, 'EX', LOCK_TTL, 'NX') !== 'OK') throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_PROCESSING', 'Upload is already processing.');
  try {
    // The previous completion may have finished between our first read and lock acquisition.
    const current = await redis.get(recordKey(input.uploadKey));
    const latest = current ? reservationSchema.parse(JSON.parse(current)) : null;
    assertBound(latest, input, context);
    if (latest!.status === 'completed') return latest!.result;
    const storage = dependencies.storage ?? documentStorage;
    const inspected = await Promise.all(record!.storageKeys.map((storageKey) => dependencies.inspect ? dependencies.inspect(storageKey) : s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })).then((head) => ({ sizeBytes: head.ContentLength, mimeType: head.ContentType })).catch(() => { throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Uploaded object is missing or unreadable.'); })));
    if (inspected.some((object, index) => object.sizeBytes !== record!.files[index]!.sizeBytes || object.mimeType?.toLowerCase() !== record!.files[index]!.mimeType.toLowerCase())) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Uploaded bytes do not match the reservation.');
    const bytes = await Promise.all(record!.storageKeys.map(async (storageKey, index) => {
      const object = await storage.download(storageKey);
      if (object.bytes.byteLength !== record!.files[index]!.sizeBytes) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Uploaded bytes do not match the reservation.');
      return object.bytes;
    }));
    const sources = record!.files.map((item, index) => ({ filename: item.filename, mimeType: item.mimeType, sizeBytes: item.sizeBytes, bytes: bytes[index]! }));
    const result = await (dependencies.run ?? runAuthenticatedContentTool)({ teamKey: record!.teamKey, scopeKey: record!.scopeKey, tool: 'document.parse', input: { scopeKey: record!.scopeKey, ...(record!.folderKey ? { folderKey: record!.folderKey } : {}), ...(record!.name ? { name: record!.name } : {}), ...(record!.kind === 'file' ? { file: sources[0]! } : { pages: sources }), idempotencyKey: record!.idempotencyKey } }, { ...options, requestKey: record!.idempotencyKey });
    // Persist the replay result before removing the staging bytes. Failed writes leave
    // the staging objects available for a canonical idempotent retry.
    const completed = reservationSchema.parse({ ...record!, status: 'completed', result });
    await redis.set(recordKey(input.uploadKey), JSON.stringify(completed), 'EX', RESERVATION_TTL);
    await Promise.all(record!.storageKeys.map((storageKey) => storage.delete(storageKey).catch(() => undefined)));
    return result;
  } finally {
    await redis.eval(unlockScript, 1, lockKey, token);
  }
}
