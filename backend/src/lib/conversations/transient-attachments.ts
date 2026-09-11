import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import { CORE_CHAT_MAX_IMAGE_BYTES } from '@/lib/ai/actions/core-chat';
import { DocumentInputError, documentValidate, type DocumentObjectStorage, documentStorage } from '@/lib/ai/document-processing';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { GalleryImageInputError, sanitizeGalleryImage } from '@/lib/gallery/image-location';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { artifactSha256, CONVERSATION_ATTACHMENT_ARTIFACT_TTL_MS, conversationAttachmentArtifactSchema, getDefaultConversationAttachmentArtifactRepository, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';

export const TRANSIENT_ATTACHMENT_RESERVATION_TTL_SECONDS = 15 * 60;
export const TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS = 60 * 60;
export const TRANSIENT_ATTACHMENT_MAX_FILES = 12;
export const TRANSIENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const TRANSIENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const CORE_ATTACHMENT_MAX_AGGREGATE_IMAGE_BYTES = 16 * 1024 * 1024;

const imageMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const documentMimeTypeSchema = z.enum(['text/plain', 'text/markdown', 'text/x-markdown', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const mimeTypeSchema = z.union([imageMimeTypeSchema, documentMimeTypeSchema]);
const filenameSchema = z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value), 'Filename is invalid.');
const fileSchema = z.object({ clientKey: z.string().trim().min(1).max(120), filename: filenameSchema, mimeType: mimeTypeSchema, sizeBytes: z.number().int().positive().max(TRANSIENT_ATTACHMENT_MAX_BYTES) }).strict().superRefine((file, context) => {
  const extension = file.filename.split('.').at(-1)?.toLowerCase();
  const valid = extension === 'jpg' || extension === 'jpeg' ? file.mimeType === 'image/jpeg'
    : extension === 'png' ? file.mimeType === 'image/png'
      : extension === 'webp' ? file.mimeType === 'image/webp'
        : extension === 'txt' ? file.mimeType === 'text/plain'
          : extension === 'md' ? ['text/markdown', 'text/x-markdown', 'text/plain'].includes(file.mimeType)
            : extension === 'pdf' ? file.mimeType === 'application/pdf'
              : extension === 'doc' ? file.mimeType === 'application/msword'
                : extension === 'docx' ? file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : false;
  if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Filename extension and MIME type must identify a supported attachment.', path: ['mimeType'] });
  if (file.mimeType.startsWith('image/') && file.sizeBytes > TRANSIENT_IMAGE_MAX_BYTES) context.addIssue({ code: z.ZodIssueCode.too_big, type: 'number', maximum: TRANSIENT_IMAGE_MAX_BYTES, inclusive: true, message: 'Image exceeds the maximum allowed size.', path: ['sizeBytes'] });
});

export const transientAttachmentReserveInputSchema = z.object({
  conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200),
  files: z.array(fileSchema).min(1).max(TRANSIENT_ATTACHMENT_MAX_FILES),
}).strict().refine(({ files }) => new Set(files.map(({ clientKey }) => clientKey)).size === files.length, 'Attachment client keys must be unique.');
export const transientAttachmentCompleteInputSchema = z.object({
  conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200),
  attachmentKeys: z.array(z.string().cuid()).min(1).max(TRANSIENT_ATTACHMENT_MAX_FILES),
}).strict().refine(({ attachmentKeys }) => new Set(attachmentKeys).size === attachmentKeys.length, 'Attachment keys must be unique.');

const imageResultSchema = z.object({ kind: z.literal('image'), filename: filenameSchema, mimeType: z.literal('image/png'), sizeBytes: z.number().int().positive().max(CORE_CHAT_MAX_IMAGE_BYTES), width: z.number().int().positive().max(4_096), height: z.number().int().positive().max(4_096), storageKey: z.string().min(1) }).strict();
const documentResultSchema = z.object({ kind: z.literal('document'), filename: filenameSchema, mimeType: documentMimeTypeSchema, sizeBytes: z.number().int().positive().max(TRANSIENT_ATTACHMENT_MAX_BYTES), storageKey: z.string().min(1) }).strict();
export const transientAttachmentResultSchema = z.discriminatedUnion('kind', [imageResultSchema, documentResultSchema]);
export const transientAttachmentRecordSchema = z.object({
  key: z.string().cuid(), binding: z.string().length(64), teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200),
  filename: filenameSchema, mimeType: mimeTypeSchema, sizeBytes: z.number().int().positive().max(TRANSIENT_ATTACHMENT_MAX_BYTES), storageKey: z.string().min(1), status: z.enum(['reserved', 'processing', 'sealed']), result: transientAttachmentResultSchema.optional(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export type TransientAttachmentRecord = z.infer<typeof transientAttachmentRecordSchema>;
export type TransientAttachmentOwner = { teamKey: string; scopeKey: string; userKey: string };

type RedisLike = Pick<typeof redisConnection, 'get' | 'set' | 'del' | 'eval'>;
type Transition = (record: TransientAttachmentRecord, next: TransientAttachmentRecord, ttlSeconds: number) => Promise<boolean>;
type SignUpload = (record: TransientAttachmentRecord) => Promise<string>;
const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;
const keyFor = (key: string) => `conversation-attachment:${key}`;
const bindingFor = (owner: TransientAttachmentOwner, conversationKey: string, requestKey: string) => createHash('sha256').update(`${owner.userKey}\0${owner.teamKey}\0${owner.scopeKey}\0${conversationKey}\0${requestKey}`).digest('hex');

const TRANSITION_SCRIPT = `
local raw = redis.call('get', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= ARGV[1] or current.binding ~= ARGV[2] then return 0 end
redis.call('set', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1`;

export interface TransientAttachmentDependencies {
  redis?: RedisLike;
  repository?: Pick<ConversationRepository, 'read'>;
  storage?: DocumentObjectStorage;
  signUpload?: SignUpload;
  sanitizeImage?: typeof sanitizeGalleryImage;
  validateDocument?: typeof documentValidate;
  inspectObject?: (storageKey: string) => Promise<{ sizeBytes?: number; mimeType?: string }>;
  transition?: Transition;
  now?: () => Date;
  id?: () => string;
  artifacts?: Pick<ConversationAttachmentArtifactRepository, 'insertPrepared' | 'readBound'>;
  ownerKey?: string;
  teamAssurance?: { teamMembershipKey: string; teamMfaVersion: number };
}

export class TransientAttachmentError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 500, readonly code: string, message: string) { super(message); this.name = 'TransientAttachmentError'; }
}

export function normalizeTransientAttachmentError(error: unknown) {
  if (error instanceof TransientAttachmentError) return error;
  if (error instanceof DocumentInputError || error instanceof GalleryImageInputError) return new TransientAttachmentError(400, error.code, error.message);
  if (error instanceof ZodError || error instanceof SyntaxError) return new TransientAttachmentError(400, 'ATTACHMENT_INVALID_INPUT', 'Attachment request input was invalid.');
  console.error('transient attachment request failed', { error });
  return new TransientAttachmentError(500, 'ATTACHMENT_FAILED', 'Attachment processing failed.');
}

function assertOwner(owner: TransientAttachmentOwner) {
  z.object({ teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid() }).strict().parse(owner);
}

async function requireConversation(owner: TransientAttachmentOwner, conversationKey: string, dependencies: TransientAttachmentDependencies) {
  if (!await (dependencies.repository ?? getDefaultConversationRepository()).read(owner, conversationKey)) throw new TransientAttachmentError(404, 'ATTACHMENT_CONVERSATION_NOT_FOUND', 'Conversation not found.');
}

function bound(record: TransientAttachmentRecord, owner: TransientAttachmentOwner, conversationKey: string, requestKey: string) {
  return record.teamKey === owner.teamKey && record.scopeKey === owner.scopeKey && record.userKey === owner.userKey && record.conversationKey === conversationKey && record.requestKey === requestKey && record.binding === bindingFor(owner, conversationKey, requestKey);
}

async function readRecord(key: string, dependencies: TransientAttachmentDependencies) {
  const raw = await (dependencies.redis ?? redisConnection).get(keyFor(key));
  return raw ? transientAttachmentRecordSchema.parse(JSON.parse(raw)) : null;
}

async function transition(record: TransientAttachmentRecord, next: TransientAttachmentRecord, ttlSeconds: number, dependencies: TransientAttachmentDependencies) {
  if (dependencies.transition) return dependencies.transition(record, next, ttlSeconds);
  return Number(await (dependencies.redis ?? redisConnection).eval(TRANSITION_SCRIPT, 1, keyFor(record.key), record.status, record.binding, JSON.stringify(transientAttachmentRecordSchema.parse(next)), String(ttlSeconds))) === 1;
}

function descriptor(record: TransientAttachmentRecord) {
  const result = record.result!;
  return result.kind === 'image'
    ? { attachmentKey: record.key, kind: result.kind, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, width: result.width, height: result.height, status: 'prepared' as const }
    : { attachmentKey: record.key, kind: result.kind, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, status: 'prepared' as const };
}

export async function reserveTransientAttachments(rawInput: unknown, owner: TransientAttachmentOwner, dependencies: TransientAttachmentDependencies = {}) {
  assertOwner(owner);
  const input = transientAttachmentReserveInputSchema.parse(rawInput);
  await requireConversation(owner, input.conversationKey, dependencies);
  const now = dependencies.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + TRANSIENT_ATTACHMENT_RESERVATION_TTL_SECONDS * 1_000).toISOString();
  const binding = bindingFor(owner, input.conversationKey, input.requestKey);
  const records = input.files.map((file) => {
    const key = (dependencies.id ?? newId)();
    const extension = file.filename.split('.').at(-1)!.toLowerCase();
    return transientAttachmentRecordSchema.parse({ key, binding, ...owner, conversationKey: input.conversationKey, requestKey: input.requestKey, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, storageKey: `pending/conversation-attachments/${owner.scopeKey}/${key}/original.${extension}`, status: 'reserved', createdAt: now.toISOString(), expiresAt });
  });
  const sign = dependencies.signUpload ?? ((record) => signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: record.storageKey, ContentType: record.mimeType }), { expiresIn: 10 * 60 }));
  const urls = await Promise.all(records.map(sign));
  const redis = dependencies.redis ?? redisConnection;
  const stored: TransientAttachmentRecord[] = [];
  try {
    for (const record of records) {
      if (await redis.set(keyFor(record.key), JSON.stringify(record), 'EX', TRANSIENT_ATTACHMENT_RESERVATION_TTL_SECONDS, 'NX') !== 'OK') throw new Error('Attachment reservation key collision.');
      stored.push(record);
    }
  } catch (error) {
    if (stored.length) await redis.del(...stored.map(({ key }) => keyFor(key)));
    throw error;
  }
  return { uploads: records.map((record, index) => ({ clientKey: input.files[index]!.clientKey, attachmentKey: record.key, url: urls[index]!, headers: { 'Content-Type': record.mimeType }, expiresAt: record.expiresAt })) };
}

async function processRecord(record: TransientAttachmentRecord, dependencies: TransientAttachmentDependencies) {
  const storage = dependencies.storage ?? documentStorage;
  const inspected = dependencies.inspectObject
    ? await dependencies.inspectObject(record.storageKey)
    : await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: record.storageKey })).then((head) => ({ sizeBytes: head.ContentLength, mimeType: head.ContentType }));
  if (inspected.sizeBytes !== record.sizeBytes || inspected.mimeType?.toLowerCase() !== record.mimeType) throw new TransientAttachmentError(409, 'ATTACHMENT_UPLOAD_MISMATCH', 'Uploaded attachment does not match its reservation.');
  const object = await storage.download(record.storageKey);
  if (object.bytes.byteLength !== record.sizeBytes || object.sizeBytes !== undefined && object.sizeBytes !== record.sizeBytes || object.mimeType !== undefined && object.mimeType.toLowerCase() !== record.mimeType) throw new TransientAttachmentError(409, 'ATTACHMENT_UPLOAD_MISMATCH', 'Uploaded attachment does not match its reservation.');
  if (record.mimeType.startsWith('image/')) {
    const sanitized = await (dependencies.sanitizeImage ?? sanitizeGalleryImage)(object.bytes);
    let canonical = await sharp(sanitized.bytes, { limitInputPixels: 100_000_000 }).resize({ width: 2_400, height: 2_400, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    let metadata = await sharp(canonical, { limitInputPixels: 100_000_000 }).metadata();
    while (canonical.byteLength > CORE_CHAT_MAX_IMAGE_BYTES && metadata.width && metadata.height && (metadata.width > 1 || metadata.height > 1)) {
      const scale = Math.min(0.9, Math.sqrt(CORE_CHAT_MAX_IMAGE_BYTES / canonical.byteLength) * 0.95);
      const width = Math.max(1, Math.floor(metadata.width * scale));
      const height = Math.max(1, Math.floor(metadata.height * scale));
      canonical = await sharp(canonical, { limitInputPixels: 100_000_000 }).resize({ width, height, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
      metadata = await sharp(canonical, { limitInputPixels: 100_000_000 }).metadata();
    }
    if (canonical.byteLength > CORE_CHAT_MAX_IMAGE_BYTES) throw new TransientAttachmentError(400, 'ATTACHMENT_IMAGE_TOO_LARGE', 'Canonical image exceeds the maximum model input size.');
    if (!metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384) throw new TransientAttachmentError(400, 'ATTACHMENT_IMAGE_INVALID', 'Canonical image dimensions are invalid.');
    const storageKey = record.storageKey.replace(/\/original\.[^/]+$/, '/canonical.png');
    await storage.upload({ key: storageKey, bytes: canonical, mimeType: 'image/png', billingUserKey: record.userKey });
    return { result: imageResultSchema.parse({ kind: 'image', filename: `${record.filename.replace(/\.[^.]+$/, '').slice(0, 251) || 'image'}.png`, mimeType: 'image/png', sizeBytes: canonical.byteLength, width: metadata.width, height: metadata.height, storageKey }), sha256: artifactSha256(canonical) };
  }
  await (dependencies.validateDocument ?? documentValidate)({ file: { filename: record.filename, mimeType: record.mimeType, sizeBytes: record.sizeBytes, bytes: object.bytes }, scopeKey: record.scopeKey }, { maxBytes: TRANSIENT_ATTACHMENT_MAX_BYTES, logger: () => undefined });
  return { result: documentResultSchema.parse({ kind: 'document', filename: record.filename, mimeType: record.mimeType, sizeBytes: record.sizeBytes, storageKey: record.storageKey }), sha256: artifactSha256(object.bytes) };
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; results[index] = await operation(values[index]!); }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

export function validateCoreAttachmentImageBytes(results: readonly z.infer<typeof transientAttachmentResultSchema>[]) {
  const imageBytes = results.reduce((total, result) => total + (result.kind === 'image' ? result.sizeBytes : 0), 0);
  if (imageBytes > CORE_ATTACHMENT_MAX_AGGREGATE_IMAGE_BYTES) throw new TransientAttachmentError(400, 'ATTACHMENT_IMAGES_TOO_LARGE', 'Canonical images exceed the 16 MiB aggregate Core input limit.');
}

export async function completeTransientAttachments(rawInput: unknown, owner: TransientAttachmentOwner, dependencies: TransientAttachmentDependencies = {}) {
  assertOwner(owner);
  const input = transientAttachmentCompleteInputSchema.parse(rawInput);
  await requireConversation(owner, input.conversationKey, dependencies);
  const storage = dependencies.storage ?? documentStorage;
  const redis = dependencies.redis ?? redisConnection;
  const artifactRepository = dependencies.artifacts ?? getDefaultConversationAttachmentArtifactRepository();
  const existing = await artifactRepository.readBound(owner, input.conversationKey, input.requestKey, input.attachmentKeys);
  if (existing.length === input.attachmentKeys.length && existing.every(({ status }) => status === 'PREPARED')) return { attachments: existing.map((artifact) => artifact.kind === 'image'
    ? { attachmentKey: artifact.key, kind: artifact.kind, filename: artifact.filename, mimeType: 'image/png' as const, sizeBytes: artifact.sizeBytes, width: artifact.width!, height: artifact.height!, status: 'prepared' as const }
    : { attachmentKey: artifact.key, kind: artifact.kind, filename: artifact.filename, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, status: 'prepared' as const }) };
  if (existing.length) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Only part of the attachment batch was already prepared.');
  const records = await mapConcurrent(input.attachmentKeys, 2, async (attachmentKey) => {
    const record = await readRecord(attachmentKey, dependencies);
    if (!record || !bound(record, owner, input.conversationKey, input.requestKey)) throw new TransientAttachmentError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment reservation not found.');
    if (record.status === 'sealed' && record.result) {
      const staged = await storage.download(record.result.storageKey);
      if (staged.bytes.byteLength !== record.result.sizeBytes) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Prepared attachment bytes changed before durable storage.');
      return { record, result: record.result, sha256: artifactSha256(staged.bytes) };
    }
    const now = dependencies.now?.() ?? new Date();
    if (record.status !== 'reserved' || Date.parse(record.expiresAt) <= now.getTime()) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation is expired or no longer pending.');
    const processing = transientAttachmentRecordSchema.parse({ ...record, status: 'processing', expiresAt: new Date(now.getTime() + TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS * 1_000).toISOString() });
    if (!await transition(record, processing, TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS, dependencies)) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation changed before processing.');
    let result: z.infer<typeof transientAttachmentResultSchema> | undefined;
    try {
      const processed = await processRecord(processing, dependencies); result = processed.result;
      const sealed = transientAttachmentRecordSchema.parse({ ...processing, status: 'sealed', result });
      if (!await transition(processing, sealed, TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS, dependencies)) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation changed before sealing.');
      return { record: sealed, result, sha256: processed.sha256 };
    } catch (error) {
      await Promise.all([record.storageKey, result?.kind === 'image' ? result.storageKey : undefined].filter((key): key is string => Boolean(key)).map((key) => storage.delete(key).catch(() => undefined)));
      await redis.del(keyFor(record.key));
      throw error;
    }
  });
  try { validateCoreAttachmentImageBytes(records.map(({ result }) => result)); } catch (error) {
    await Promise.all(records.flatMap(({ record, result }) => [record.storageKey, result.kind === 'image' ? result.storageKey : undefined]).filter((key): key is string => Boolean(key)).map((key) => storage.delete(key).catch(() => undefined)));
    await redis.del(...input.attachmentKeys.map(keyFor));
    throw error;
  }
  await Promise.all(records.filter(({ result }) => result.kind === 'image').map(({ record }) => storage.delete(record.storageKey)));
  const createdAt = (dependencies.now?.() ?? new Date()).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + CONVERSATION_ATTACHMENT_ARTIFACT_TTL_MS).toISOString();
  const artifacts = records.map(({ record, result, sha256 }) => conversationAttachmentArtifactSchema.parse({
    key: record.key, ownerKey: dependencies.ownerKey ?? owner.userKey, ...owner, conversationKey: record.conversationKey, requestKey: record.requestKey, ...(dependencies.teamAssurance ? { teamAssurance: dependencies.teamAssurance } : {}),
    kind: result.kind, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, ...(result.kind === 'image' ? { width: result.width, height: result.height } : {}),
    stagedStorageKey: result.storageKey, stagedSha256: sha256, status: 'PREPARED', attempts: 0, availableAt: createdAt, createdAt, expiresAt,
  }));
  const inserted = await artifactRepository.insertPrepared(artifacts);
  const durable = inserted.length === artifacts.length ? inserted : await artifactRepository.readBound(owner, input.conversationKey, input.requestKey, input.attachmentKeys);
  if (durable.length !== artifacts.length) throw new Error('Prepared attachment artifacts could not be durably recorded.');
  await redis.del(...input.attachmentKeys.map(keyFor));
  return { attachments: records.map(({ record }) => descriptor(record)) };
}
