import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { AgentRuntimeNotFoundError } from '@/lib/ai/agents/runtime';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '@/lib/ai/document-processing/actions';
import { DocumentError, documentToolInputSchemas, documentToolNameSchema, isDocumentMutation, runDocumentAgentTool, type DocumentErrorCode, type RunDocumentAgentToolOptions } from '@/lib/ai/tools/document-tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const bodySchema = strictObject({ organizationKey: z.string().trim().min(1), agentKey: z.string().cuid(), input: z.unknown() });
type DocumentToolRunner = (input: Parameters<typeof runDocumentAgentTool>[0], options: RunDocumentAgentToolOptions) => Promise<unknown>;
export interface DocumentToolHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  run?: DocumentToolRunner;
  serviceOptions?: Omit<RunDocumentAgentToolOptions, 'authenticatedUserKey'>;
  maxDocumentBytes?: number;
}

function responseError(error: DocumentError) { return { success: false as const, error: error.toJSON() }; }
function documentStatus(code: DocumentErrorCode): 400 | 401 | 403 | 404 | 409 | 500 {
  if (code === 'DOCUMENT_UNAUTHORIZED') return 401;
  if (code === 'DOCUMENT_FORBIDDEN') return 403;
  if (code === 'DOCUMENT_NOT_FOUND') return 404;
  if (code === 'DOCUMENT_CONFLICT' || code === 'DOCUMENT_VERSION_CONFLICT' || code === 'FOLDER_CYCLE_DETECTED' || code === 'FOLDER_NOT_EMPTY' || code === 'FOLDER_DOCUMENTD' || code === 'FOLDER_MOVE_FORBIDDEN' || code === 'DOCUMENT_DOCUMENTD') return 409;
  if (code === 'DOCUMENT_PROCESSING_FAILED' || code === 'DOCUMENT_EXTRACTION_FAILED' || code === 'DOCUMENT_EMBEDDING_FAILED' || code === 'DOCUMENT_INSERT_FAILED' || code === 'DOCUMENT_SPEECH_FAILED' || code === 'DOCUMENT_SEARCH_EMBEDDING_FAILED') return 500;
  return 400;
}

function normalizeDocumentUpload(input: unknown, maxBytes: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const upload = z.object({
    filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive(), encoding: z.literal('base64'), content: z.string().min(1),
  }).strict().parse(record.file);
  if (upload.sizeBytes > maxBytes || upload.content.length > Math.ceil(maxBytes / 3) * 4) throw new DocumentError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.processing', { action: 'parse' });
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.content)) throw new DocumentError('DOCUMENT_INVALID_INPUT', 'Document content must be canonical base64.', 'document.processing', { action: 'parse' });
  const padding = upload.content.endsWith('==') ? 2 : upload.content.endsWith('=') ? 1 : 0;
  const decodedSize = upload.content.length / 4 * 3 - padding;
  if (decodedSize > maxBytes) throw new DocumentError('DOCUMENT_TOO_LARGE', 'The document exceeds the maximum allowed size.', 'document.processing', { action: 'parse' });
  if (decodedSize !== upload.sizeBytes) throw new DocumentError('DOCUMENT_INVALID_INPUT', 'Document size does not match its content.', 'document.processing', { action: 'parse' });
  return { ...record, file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, bytes: new Uint8Array(Buffer.from(upload.content, 'base64')) } };
}

export function createDocumentToolHandler(dependencies: DocumentToolHandlerDependencies = {}) {
  return async (c: Context) => {
    const rawTool = c.req.param('tool');
    let tool: z.infer<typeof documentToolNameSchema>;
    try { tool = documentToolNameSchema.parse(rawTool); }
    catch { return c.json(responseError(new DocumentError('DOCUMENT_INVALID_INPUT', 'Unknown Document tool.', rawTool || 'unknown', { action: 'parse' })), 400); }
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json(responseError(new DocumentError('DOCUMENT_UNAUTHORIZED', 'Authentication required.', tool, { action: 'authorization' })), 401);
    if (identity.identityType !== 'user') return c.json(responseError(new DocumentError('DOCUMENT_FORBIDDEN', 'A user session is required.', tool, { action: 'authorization' })), 403);
    try {
      const body = await parseJson(c, bodySchema);
      const maximum = dependencies.maxDocumentBytes ?? Number(process.env.DOCUMENT_MAX_DOCUMENT_BYTES ?? DEFAULT_MAX_DOCUMENT_BYTES);
      let input = tool === 'document.processing' ? normalizeDocumentUpload(body.input, maximum) : body.input;
      input = documentToolInputSchemas[tool].parse(input);
      const idempotencyKey = c.req.header('idempotency-key')?.trim();
      if (idempotencyKey && idempotencyKey.length > 200) throw new DocumentError('DOCUMENT_INVALID_INPUT', 'Idempotency-Key is too long.', tool, { action: 'parse' });
      if (isDocumentMutation(tool, input)) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DocumentError('DOCUMENT_INVALID_INPUT', 'Document tool input must be an object.', tool, { action: 'parse' });
        const existing = (input as Record<string, unknown>).idempotencyKey;
        if (idempotencyKey && existing !== undefined && existing !== idempotencyKey) throw new DocumentError('DOCUMENT_CONFLICT', 'Idempotency key does not match the request body.', tool, { action: 'idempotency' });
        if (idempotencyKey) input = { ...(input as Record<string, unknown>), idempotencyKey };
      }
      input = documentToolInputSchemas[tool].parse(input);
      const output = await (dependencies.run ?? runDocumentAgentTool)({ organizationKey: body.organizationKey, agentKey: body.agentKey, tool, input }, { ...dependencies.serviceOptions, authenticatedUserKey: identity.key });
      return c.json({ success: true, data: output });
    } catch (error) {
      if (error instanceof DocumentError) return c.json(responseError(error), documentStatus(error.code));
      if (error instanceof AgentExecutionAccessError) return c.json(responseError(new DocumentError('DOCUMENT_FORBIDDEN', 'Agent execution access denied.', tool, { action: 'authorization' })), 403);
      if (error instanceof AgentRuntimeNotFoundError) return c.json(responseError(new DocumentError('DOCUMENT_NOT_FOUND', 'Agent runtime was not found.', tool, { action: 'authorization' })), 404);
      if (error instanceof ZodError) return c.json(responseError(new DocumentError('DOCUMENT_INVALID_INPUT', 'Document request input was invalid.', tool, { action: 'parse' })), 400);
      if (error instanceof SyntaxError) return c.json(responseError(new DocumentError('DOCUMENT_INVALID_INPUT', 'Request body must be valid JSON.', tool, { action: 'parse' })), 400);
      return c.json(responseError(new DocumentError('DOCUMENT_PROCESSING_FAILED', 'Document tool invocation failed.', tool, { action: 'execute' })), 500);
    }
  };
}

export const invokeDocumentTool = createDocumentToolHandler();
