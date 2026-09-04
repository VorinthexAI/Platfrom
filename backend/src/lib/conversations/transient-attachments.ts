import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import { CORE_CHAT_MAX_IMAGE_BYTES } from '@/lib/ai/actions/core-chat';
import { DocumentInputError, documentExtract, documentValidate, type DocumentObjectStorage, documentStorage } from '@/lib/ai/document-processing';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { GalleryImageInputError, sanitizeGalleryImage } from '@/lib/gallery/image-location';
import { assertStorageGrowthAllowed, StorageUnfundedError } from '@/lib/automations/storage-charger-repository';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';

export const TRANSIENT_ATTACHMENT_RESERVATION_TTL_SECONDS = 15 * 60;
export const TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS = 60 * 60;
export const TRANSIENT_ATTACHMENT_MAX_FILES = 10;
export const TRANSIENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const TRANSIENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const TRANSIENT_DOCUMENT_MAX_TEXT_BYTES = 250_000;

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
export const transientAttachmentClaimInputSchema = z.object({ conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200), attachmentKey: z.string().cuid() }).strict();

const imageResultSchema = z.object({ kind: z.literal('image'), filename: filenameSchema, mimeType: z.literal('image/png'), sizeBytes: z.number().int().positive().max(CORE_CHAT_MAX_IMAGE_BYTES), width: z.number().int().positive().max(4_096), height: z.number().int().positive().max(4_096), storageKey: z.string().min(1) }).strict();
const documentResultSchema = z.object({ kind: z.literal('document'), filename: filenameSchema, mimeType: documentMimeTypeSchema, sizeBytes: z.number().int().positive().max(TRANSIENT_ATTACHMENT_MAX_BYTES), content: z.string().trim().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= TRANSIENT_DOCUMENT_MAX_TEXT_BYTES, `Extracted text must not exceed ${TRANSIENT_DOCUMENT_MAX_TEXT_BYTES} bytes.`), metadata: z.record(z.unknown()).optional() }).strict();
export const transientAttachmentResultSchema = z.discriminatedUnion('kind', [imageResultSchema, documentResultSchema]);
export const transientAttachmentRecordSchema = z.object({
  key: z.string().cuid(), binding: z.string().length(64), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200),
  filename: filenameSchema, mimeType: mimeTypeSchema, sizeBytes: z.number().int().positive().max(TRANSIENT_ATTACHMENT_MAX_BYTES), storageKey: z.string().min(1), status: z.enum(['reserved', 'processing', 'sealed', 'claimed']), result: transientAttachmentResultSchema.optional(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export type TransientAttachmentRecord = z.infer<typeof transientAttachmentRecordSchema>;
export type TransientAttachmentOwner = { organizationKey: string; scopeKey: string; userKey: string };

type RedisLike = Pick<typeof redisConnection, 'get' | 'set' | 'del' | 'eval'>;
type Transition = (record: TransientAttachmentRecord, next: TransientAttachmentRecord, ttlSeconds: number) => Promise<boolean>;
type SignUpload = (record: TransientAttachmentRecord) => Promise<string>;
const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;
const keyFor = (key: string) => `conversation-attachment:${key}`;
const bindingFor = (owner: TransientAttachmentOwner, conversationKey: string, requestKey: string) => createHash('sha256').update(`${owner.userKey}\0${owner.organizationKey}\0${owner.scopeKey}\0${conversationKey}\0${requestKey}`).digest('hex');

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
  extractDocument?: typeof documentExtract;
  inspectObject?: (storageKey: string) => Promise<{ sizeBytes?: number; mimeType?: string }>;
  transition?: Transition;
  now?: () => Date;
  id?: () => string;
}

export class TransientAttachmentError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 500, readonly code: string, message: string) { super(message); this.name = 'TransientAttachmentError'; }
}

export function normalizeTransientAttachmentError(error: unknown) {
  if (error instanceof TransientAttachmentError) return error;
  if (error instanceof StorageUnfundedError) return new TransientAttachmentError(409, error.code, error.message);
  if (error instanceof DocumentInputError || error instanceof GalleryImageInputError) return new TransientAttachmentError(400, error.code, error.message);
  if (error instanceof ZodError || error instanceof SyntaxError) return new TransientAttachmentError(400, 'ATTACHMENT_INVALID_INPUT', 'Attachment request input was invalid.');
  console.error('transient attachment request failed', { error });
  return new TransientAttachmentError(500, 'ATTACHMENT_FAILED', 'Attachment processing failed.');
}

function assertOwner(owner: TransientAttachmentOwner) {
  z.object({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid() }).strict().parse(owner);
}

async function requireConversation(owner: TransientAttachmentOwner, conversationKey: string, dependencies: TransientAttachmentDependencies) {
  if (!await (dependencies.repository ?? getDefaultConversationRepository()).read(owner, conversationKey)) throw new TransientAttachmentError(404, 'ATTACHMENT_CONVERSATION_NOT_FOUND', 'Conversation not found.');
}

function bound(record: TransientAttachmentRecord, owner: TransientAttachmentOwner, conversationKey: string, requestKey: string) {
  return record.organizationKey === owner.organizationKey && record.scopeKey === owner.scopeKey && record.userKey === owner.userKey && record.conversationKey === conversationKey && record.requestKey === requestKey && record.binding === bindingFor(owner, conversationKey, requestKey);
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
    ? { attachmentKey: record.key, kind: result.kind, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, width: result.width, height: result.height, status: 'sealed' as const }
    : { attachmentKey: record.key, kind: result.kind, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, extractedCharacters: result.content.length, status: 'sealed' as const };
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
  if (!dependencies.signUpload) await assertStorageGrowthAllowed(owner.userKey);
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
    const canonical = await sharp(sanitized.bytes, { limitInputPixels: 100_000_000 }).resize({ width: 2_400, height: 2_400, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    if (canonical.byteLength > CORE_CHAT_MAX_IMAGE_BYTES) throw new TransientAttachmentError(400, 'ATTACHMENT_IMAGE_TOO_LARGE', 'Canonical image exceeds the maximum model input size.');
    const metadata = await sharp(canonical, { limitInputPixels: 100_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 16_384 || metadata.height > 16_384) throw new TransientAttachmentError(400, 'ATTACHMENT_IMAGE_INVALID', 'Canonical image dimensions are invalid.');
    const storageKey = record.storageKey.replace(/\/original\.[^/]+$/, '/canonical.png');
    await storage.upload({ key: storageKey, bytes: canonical, mimeType: 'image/png', billingUserKey: record.userKey });
    return imageResultSchema.parse({ kind: 'image', filename: `${record.filename.replace(/\.[^.]+$/, '').slice(0, 251) || 'image'}.png`, mimeType: 'image/png', sizeBytes: canonical.byteLength, width: metadata.width, height: metadata.height, storageKey });
  }
  const normalized = await (dependencies.validateDocument ?? documentValidate)({ file: { filename: record.filename, mimeType: record.mimeType, sizeBytes: record.sizeBytes, bytes: object.bytes }, scopeKey: record.scopeKey }, { maxBytes: TRANSIENT_ATTACHMENT_MAX_BYTES, logger: () => undefined });
  const extracted = await (dependencies.extractDocument ?? documentExtract)({ ...normalized, storageKey: record.storageKey }, { logger: () => undefined });
  return documentResultSchema.parse({ kind: 'document', filename: record.filename, mimeType: record.mimeType, sizeBytes: record.sizeBytes, content: extracted.extractedText, ...(extracted.metadata ? { metadata: extracted.metadata } : {}) });
}

export async function completeTransientAttachments(rawInput: unknown, owner: TransientAttachmentOwner, dependencies: TransientAttachmentDependencies = {}) {
  assertOwner(owner);
  const input = transientAttachmentCompleteInputSchema.parse(rawInput);
  await requireConversation(owner, input.conversationKey, dependencies);
  const storage = dependencies.storage ?? documentStorage;
  const redis = dependencies.redis ?? redisConnection;
  const attachments = [];
  for (const attachmentKey of input.attachmentKeys) {
    const record = await readRecord(attachmentKey, dependencies);
    if (!record || !bound(record, owner, input.conversationKey, input.requestKey)) throw new TransientAttachmentError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment reservation not found.');
    if (record.status === 'sealed') { attachments.push(descriptor(record)); continue; }
    const now = dependencies.now?.() ?? new Date();
    if (record.status !== 'reserved' || Date.parse(record.expiresAt) <= now.getTime()) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation is expired or no longer pending.');
    const processing = transientAttachmentRecordSchema.parse({ ...record, status: 'processing', expiresAt: new Date(now.getTime() + TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS * 1_000).toISOString() });
    if (!await transition(record, processing, TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS, dependencies)) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation changed before processing.');
    let result: z.infer<typeof transientAttachmentResultSchema> | undefined;
    try {
      result = await processRecord(processing, dependencies);
      const sealed = transientAttachmentRecordSchema.parse({ ...processing, status: 'sealed', result });
      if (!await transition(processing, sealed, TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS, dependencies)) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Attachment reservation changed before sealing.');
      await storage.delete(record.storageKey).catch(() => undefined);
      attachments.push(descriptor(sealed));
    } catch (error) {
      await Promise.all([record.storageKey, result?.kind === 'image' ? result.storageKey : undefined].filter((key): key is string => Boolean(key)).map((key) => storage.delete(key).catch(() => undefined)));
      await redis.del(keyFor(record.key));
      throw error;
    }
  }
  return { attachments };
}

export async function claimTransientAttachment(rawInput: unknown, owner: TransientAttachmentOwner, dependencies: TransientAttachmentDependencies = {}) {
  assertOwner(owner);
  const input = transientAttachmentClaimInputSchema.parse(rawInput);
  const record = await readRecord(input.attachmentKey, dependencies);
  if (!record || !bound(record, owner, input.conversationKey, input.requestKey)) throw new TransientAttachmentError(404, 'ATTACHMENT_NOT_FOUND', 'Sealed attachment not found.');
  if (record.status !== 'sealed' || !record.result) throw new TransientAttachmentError(409, 'ATTACHMENT_NOT_CLAIMABLE', 'Attachment is not claimable.');
  const claimed = transientAttachmentRecordSchema.parse({ ...record, status: 'claimed' });
  if (!await transition(record, claimed, TRANSIENT_ATTACHMENT_SEALED_TTL_SECONDS, dependencies)) throw new TransientAttachmentError(409, 'ATTACHMENT_NOT_CLAIMABLE', 'Attachment was already claimed.');
  return claimed;
}

export async function releaseTransientAttachment(record: TransientAttachmentRecord, dependencies: TransientAttachmentDependencies = {}) {
  const parsed = transientAttachmentRecordSchema.parse(record);
  if (parsed.status !== 'claimed') throw new TransientAttachmentError(409, 'ATTACHMENT_NOT_CLAIMED', 'Only a claimed attachment can be released.');
  const current = await readRecord(parsed.key, dependencies);
  if (!current || current.status !== 'claimed' || current.binding !== parsed.binding) throw new TransientAttachmentError(409, 'ATTACHMENT_CHANGED', 'Claimed attachment metadata changed before cleanup.');
  const storage = dependencies.storage ?? documentStorage;
  await Promise.all([parsed.storageKey, parsed.result?.kind === 'image' ? parsed.result.storageKey : undefined].filter((key): key is string => Boolean(key)).map((key) => storage.delete(key).catch(() => undefined)));
  await (dependencies.redis ?? redisConnection).del(keyFor(parsed.key));
}
