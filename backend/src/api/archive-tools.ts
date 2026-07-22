import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { AgentRuntimeNotFoundError } from '@/lib/ai/agents/runtime';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '@/lib/ai/document-processing/actions';
import { ArchiveError, archiveToolInputSchemas, archiveToolNameSchema, isArchiveMutation, runArchiveAgentTool, type ArchiveErrorCode, type RunArchiveAgentToolOptions } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const bodySchema = strictObject({ organizationKey: z.string().trim().min(1), agentKey: z.string().cuid(), input: z.unknown() });
type ArchiveToolRunner = (input: Parameters<typeof runArchiveAgentTool>[0], options: RunArchiveAgentToolOptions) => Promise<unknown>;
export interface ArchiveToolHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  run?: ArchiveToolRunner;
  serviceOptions?: Omit<RunArchiveAgentToolOptions, 'authenticatedUserKey'>;
  maxDocumentBytes?: number;
}

function responseError(error: ArchiveError) { return { success: false as const, error: error.toJSON() }; }
function archiveStatus(code: ArchiveErrorCode): 400 | 401 | 403 | 404 | 409 | 500 {
  if (code === 'ARCHIVE_UNAUTHORIZED') return 401;
  if (code === 'ARCHIVE_FORBIDDEN') return 403;
  if (code === 'ARCHIVE_NOT_FOUND') return 404;
  if (code === 'ARCHIVE_CONFLICT' || code === 'DOCUMENT_VERSION_CONFLICT' || code === 'FOLDER_CYCLE_DETECTED' || code === 'FOLDER_NOT_EMPTY' || code === 'FOLDER_ARCHIVED' || code === 'FOLDER_MOVE_FORBIDDEN' || code === 'DOCUMENT_ARCHIVED') return 409;
  if (code === 'DOCUMENT_PROCESSING_FAILED' || code === 'DOCUMENT_EXTRACTION_FAILED' || code === 'DOCUMENT_EMBEDDING_FAILED' || code === 'DOCUMENT_INSERT_FAILED' || code === 'DOCUMENT_SPEECH_FAILED' || code === 'ARCHIVE_SEARCH_EMBEDDING_FAILED') return 500;
  return 400;
}

function normalizeDocumentUpload(input: unknown, maxBytes: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const upload = z.object({
    filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive(), encoding: z.literal('base64'), content: z.string().min(1),
  }).strict().parse(record.file);
  if (upload.sizeBytes > maxBytes || upload.content.length > Math.ceil(maxBytes / 3) * 4) throw new ArchiveError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.processing', { action: 'parse' });
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.content)) throw new ArchiveError('ARCHIVE_INVALID_INPUT', 'Document content must be canonical base64.', 'document.processing', { action: 'parse' });
  const padding = upload.content.endsWith('==') ? 2 : upload.content.endsWith('=') ? 1 : 0;
  const decodedSize = upload.content.length / 4 * 3 - padding;
  if (decodedSize > maxBytes) throw new ArchiveError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.processing', { action: 'parse' });
  if (decodedSize !== upload.sizeBytes) throw new ArchiveError('ARCHIVE_INVALID_INPUT', 'Document size does not match its content.', 'document.processing', { action: 'parse' });
  return { ...record, file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, bytes: new Uint8Array(Buffer.from(upload.content, 'base64')) } };
}

export function createArchiveToolHandler(dependencies: ArchiveToolHandlerDependencies = {}) {
  return async (c: Context) => {
    const rawTool = c.req.param('tool');
    let tool: z.infer<typeof archiveToolNameSchema>;
    try { tool = archiveToolNameSchema.parse(rawTool); }
    catch { return c.json(responseError(new ArchiveError('ARCHIVE_INVALID_INPUT', 'Unknown Archive tool.', rawTool || 'unknown', { action: 'parse' })), 400); }
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json(responseError(new ArchiveError('ARCHIVE_UNAUTHORIZED', 'Authentication required.', tool, { action: 'authorization' })), 401);
    if (identity.identityType !== 'user') return c.json(responseError(new ArchiveError('ARCHIVE_FORBIDDEN', 'A user session is required.', tool, { action: 'authorization' })), 403);
    try {
      const body = await parseJson(c, bodySchema);
      const maximum = dependencies.maxDocumentBytes ?? Number(process.env.ARCHIVE_MAX_DOCUMENT_BYTES ?? DEFAULT_MAX_DOCUMENT_BYTES);
      let input = tool === 'document.processing' ? normalizeDocumentUpload(body.input, maximum) : body.input;
      input = archiveToolInputSchemas[tool].parse(input);
      const idempotencyKey = c.req.header('idempotency-key')?.trim();
      if (idempotencyKey && idempotencyKey.length > 200) throw new ArchiveError('ARCHIVE_INVALID_INPUT', 'Idempotency-Key is too long.', tool, { action: 'parse' });
      if (isArchiveMutation(tool, input)) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ArchiveError('ARCHIVE_INVALID_INPUT', 'Archive tool input must be an object.', tool, { action: 'parse' });
        const existing = (input as Record<string, unknown>).idempotencyKey;
        if (idempotencyKey && existing !== undefined && existing !== idempotencyKey) throw new ArchiveError('ARCHIVE_CONFLICT', 'Idempotency key does not match the request body.', tool, { action: 'idempotency' });
        if (idempotencyKey) input = { ...(input as Record<string, unknown>), idempotencyKey };
      }
      input = archiveToolInputSchemas[tool].parse(input);
      const output = await (dependencies.run ?? runArchiveAgentTool)({ organizationKey: body.organizationKey, agentKey: body.agentKey, tool, input }, { ...dependencies.serviceOptions, authenticatedUserKey: identity.key });
      return c.json({ success: true, data: output });
    } catch (error) {
      if (error instanceof ArchiveError) return c.json(responseError(error), archiveStatus(error.code));
      if (error instanceof AgentExecutionAccessError) return c.json(responseError(new ArchiveError('ARCHIVE_FORBIDDEN', 'Agent execution access denied.', tool, { action: 'authorization' })), 403);
      if (error instanceof AgentRuntimeNotFoundError) return c.json(responseError(new ArchiveError('ARCHIVE_NOT_FOUND', 'Agent runtime was not found.', tool, { action: 'authorization' })), 404);
      if (error instanceof ZodError) return c.json(responseError(new ArchiveError('ARCHIVE_INVALID_INPUT', 'Archive request input was invalid.', tool, { action: 'parse' })), 400);
      if (error instanceof SyntaxError) return c.json(responseError(new ArchiveError('ARCHIVE_INVALID_INPUT', 'Request body must be valid JSON.', tool, { action: 'parse' })), 400);
      return c.json(responseError(new ArchiveError('DOCUMENT_PROCESSING_FAILED', 'Archive tool invocation failed.', tool, { action: 'execute' })), 500);
    }
  };
}

export const invokeArchiveTool = createArchiveToolHandler();
