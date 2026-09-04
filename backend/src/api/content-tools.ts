import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { DEFAULT_MAX_DOCUMENT_BYTES, positiveDocumentLimit } from '@/lib/ai/document-processing/actions';
import { MAX_DOCUMENT_SCAN_PAGE_BYTES } from '@/lib/ai/document-scanning';
import { ContentError, contentToolInputSchemas, contentToolNameSchema, isContentMutation, runAuthenticatedContentTool, type ContentErrorCode, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';
import { sparkErrorResponse } from './errors';
import { lookupToolCostPolicy } from '@/lib/costs';
import { toolEventService } from '@/lib/ai/events/service';
import { createHash } from 'node:crypto';

const bodySchema = strictObject({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), input: z.unknown() });
const delayedDevTools = new Set(['folder.list', 'document.list', 'content.search-history.list']);
const internalOnlyTools = new Set(['document.enhance', 'document.translate']);
type ContentToolRunner = (input: Parameters<typeof runAuthenticatedContentTool>[0], options: RunAuthenticatedContentToolOptions) => Promise<unknown>;
export interface ContentToolHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  run?: ContentToolRunner;
  serviceOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey'>;
  maxDocumentBytes?: number;
}

function responseError(error: ContentError) { return { success: false as const, error: error.toJSON() }; }
function contentStatus(code: ContentErrorCode): 400 | 401 | 403 | 404 | 409 | 500 {
  if (code === 'CONTENT_UNAUTHORIZED') return 401;
  if (code === 'CONTENT_FORBIDDEN') return 403;
  if (code === 'CONTENT_NOT_FOUND') return 404;
  if (code === 'CONTENT_CONFLICT' || code.startsWith('CONTENT_IDEMPOTENCY_') || code === 'DOCUMENT_VERSION_CONFLICT' || code === 'FOLDER_CYCLE_DETECTED' || code === 'FOLDER_NOT_EMPTY' || code === 'FOLDER_ARCHIVED' || code === 'FOLDER_MOVE_FORBIDDEN' || code === 'DOCUMENT_ARCHIVED') return 409;
  if (code === 'DOCUMENT_PROCESSING_FAILED' || code === 'DOCUMENT_EXTRACTION_FAILED' || code === 'DOCUMENT_EMBEDDING_FAILED' || code === 'DOCUMENT_INSERT_FAILED' || code === 'DOCUMENT_SPEECH_FAILED' || code === 'CONTENT_SEARCH_EMBEDDING_FAILED') return 500;
  return 400;
}

function normalizeDocumentUpload(input: unknown, maxBytes: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const upload = z.object({
    filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive(), encoding: z.literal('base64'), content: z.string().min(1),
  }).strict().parse(record.file);
  if (upload.sizeBytes > maxBytes || upload.content.length > Math.ceil(maxBytes / 3) * 4) throw new ContentError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.parse', { action: 'parse' });
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.content)) throw new ContentError('CONTENT_INVALID_INPUT', 'Document content must be canonical base64.', 'document.parse', { action: 'parse' });
  const padding = upload.content.endsWith('==') ? 2 : upload.content.endsWith('=') ? 1 : 0;
  const decodedSize = upload.content.length / 4 * 3 - padding;
  if (decodedSize > maxBytes) throw new ContentError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.parse', { action: 'parse' });
  if (decodedSize !== upload.sizeBytes) throw new ContentError('CONTENT_INVALID_INPUT', 'Document size does not match its content.', 'document.parse', { action: 'parse' });
  return { ...record, file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, bytes: new Uint8Array(Buffer.from(upload.content, 'base64')) } };
}

function normalizeDocumentScan(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const pages = z.array(z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.enum(['image/jpeg', 'image/png']), sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_SCAN_PAGE_BYTES), encoding: z.literal('base64'), content: z.string().min(1) }).strict()).min(1).max(12).parse(record.pages);
  const normalized = pages.map((page) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.content)) throw new ContentError('CONTENT_INVALID_INPUT', 'Scan page content must be canonical base64.', 'document.scan', { action: 'parse' });
    const bytes = new Uint8Array(Buffer.from(page.content, 'base64'));
    if (bytes.byteLength !== page.sizeBytes) throw new ContentError('CONTENT_INVALID_INPUT', 'Scan page size does not match its content.', 'document.scan', { action: 'parse' });
    return { filename: page.filename, mimeType: page.mimeType, sizeBytes: page.sizeBytes, bytes };
  });
  return { ...record, pages: normalized };
}

async function parseLimitedBody(c: Context, tool: string, maxDocumentBytes: number) {
  const maximum = Math.ceil(maxDocumentBytes / 3) * 4 + 64 * 1024;
  const declared = c.req.header('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new ContentError('DOCUMENT_TOO_LARGE', 'The request body exceeds the maximum allowed size.', tool, { action: 'parse' });
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new SyntaxError('Request body is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new ContentError('DOCUMENT_TOO_LARGE', 'The request body exceeds the maximum allowed size.', tool, { action: 'parse' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bodySchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export function createContentToolHandler(dependencies: ContentToolHandlerDependencies = {}) {
  return async (c: Context) => {
    const rawTool = c.req.param('tool');
    let tool: z.infer<typeof contentToolNameSchema>;
    try { tool = contentToolNameSchema.parse(rawTool); }
    catch { return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Unknown Content tool.', rawTool || 'unknown', { action: 'parse' })), 400); }
    if (internalOnlyTools.has(tool)) return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Use the unified app transformation API.', tool, { action: 'parse' })), 400);
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json(responseError(new ContentError('CONTENT_UNAUTHORIZED', 'Authentication required.', tool, { action: 'authorization' })), 401);
    if (identity.identityType !== 'user') return c.json(responseError(new ContentError('CONTENT_FORBIDDEN', 'A user session is required.', tool, { action: 'authorization' })), 403);
    try {
      const maximum = positiveDocumentLimit(dependencies.maxDocumentBytes ?? process.env.CONTENT_MAX_DOCUMENT_BYTES, DEFAULT_MAX_DOCUMENT_BYTES);
      const body = await parseLimitedBody(c, tool, maximum);
      let input = tool === 'document.parse' ? normalizeDocumentUpload(body.input, maximum) : tool === 'document.scan' ? normalizeDocumentScan(body.input) : body.input;
      input = contentToolInputSchemas[tool].parse(input);
      let idempotencyKey = c.req.header('idempotency-key')?.trim();
      if (idempotencyKey && idempotencyKey.length > 200) throw new ContentError('CONTENT_INVALID_INPUT', 'Idempotency-Key is too long.', tool, { action: 'parse' });
      const costPolicy = lookupToolCostPolicy(tool, input);
      if (costPolicy?.mode === 'fixed' && !idempotencyKey) throw new ContentError('CONTENT_INVALID_INPUT', 'Idempotency-Key is required for priced Content operations.', tool, { action: 'idempotency' });
      if (!idempotencyKey && (costPolicy?.mode === 'action' || costPolicy?.mode === 'outcome')) idempotencyKey = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      if (isContentMutation(tool, input)) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentError('CONTENT_INVALID_INPUT', 'Content tool input must be an object.', tool, { action: 'parse' });
        const existing = (input as Record<string, unknown>).idempotencyKey;
        if (idempotencyKey && existing !== undefined && existing !== idempotencyKey) throw new ContentError('CONTENT_CONFLICT', 'Idempotency key does not match the request body.', tool, { action: 'idempotency' });
        if (idempotencyKey) input = { ...(input as Record<string, unknown>), idempotencyKey };
      }
      input = contentToolInputSchemas[tool].parse(input);
      const devDelayMs = process.env.NODE_ENV !== 'production' && delayedDevTools.has(tool)
        ? Number(process.env.CONTENT_DEV_READ_DELAY_MS ?? 0)
        : 0;
      if (Number.isFinite(devDelayMs) && devDelayMs > 0) await Bun.sleep(Math.min(devDelayMs, 5_000));
      const output = await (dependencies.run ?? runAuthenticatedContentTool)({ organizationKey: body.organizationKey, scopeKey: body.scopeKey, tool, input }, { ...dependencies.serviceOptions, authenticatedUserKey: identity.key, recordEvent: dependencies.serviceOptions?.recordEvent ?? toolEventService.record, ...(idempotencyKey ? { requestKey: idempotencyKey } : {}), contentDependencies: { ...dependencies.serviceOptions?.contentDependencies, signal: c.req.raw.signal } });
      return c.json({ success: true, data: output });
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof ContentError) return c.json(responseError(error), contentStatus(error.code));
      if (error instanceof ZodError) return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Content request input was invalid.', tool, { action: 'parse' })), 400);
      if (error instanceof SyntaxError) return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Request body must be valid JSON.', tool, { action: 'parse' })), 400);
      return c.json(responseError(new ContentError('DOCUMENT_PROCESSING_FAILED', 'Content tool invocation failed.', tool, { action: 'execute' })), 500);
    }
  };
}

export const invokeContentTool = createContentToolHandler();
