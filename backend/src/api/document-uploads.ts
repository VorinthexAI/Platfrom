import type { Context } from 'hono';
import { ZodError } from 'zod';
import { authorizeContentExecution, ContentError } from '@/lib/ai/tools';
import { completeDocumentUpload, documentUploadCompleteSchema, documentUploadReserveSchema, DocumentUploadError, reserveDocumentUpload } from '@/lib/ai/document-processing/direct-upload';
import { getAuthIdentity } from './security';
import { authenticatedTeamContext } from './auth';
import { parseJson } from './validation';
import { sparkErrorResponse } from './errors';

export interface DocumentUploadHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: typeof authorizeContentExecution;
  reserve?: typeof reserveDocumentUpload;
  complete?: typeof completeDocumentUpload;
}

export function createDocumentUploadHandlers(dependencies: DocumentUploadHandlerDependencies = {}) {
  const invoke = async (c: Context, operation: 'reserve' | 'complete') => {
    try {
      const body = await parseJson(c, operation === 'reserve' ? documentUploadReserveSchema : documentUploadCompleteSchema);
      const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
      if (!identity) return c.json({ success: false, error: { code: 'CONTENT_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'CONTENT_FORBIDDEN', message: 'User session required.' } }, 403);
      const options = authenticatedTeamContext(identity);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey: body.teamKey, scopeKey: body.scopeKey }, options);
      if (operation === 'reserve') return c.json({ success: true, data: await (dependencies.reserve ?? reserveDocumentUpload)(documentUploadReserveSchema.parse(body), context) }, 201);
      return c.json({ success: true, data: await (dependencies.complete ?? completeDocumentUpload)(documentUploadCompleteSchema.parse(body), context, { ...options, contentDependencies: { signal: c.req.raw.signal } }) });
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof DocumentUploadError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : error.code === 'CONTENT_UNAUTHORIZED' ? 401 : error.code === 'CONTENT_CONFLICT' || error.code.startsWith('CONTENT_IDEMPOTENCY_') ? 409 : error.code === 'DOCUMENT_PROCESSING_FAILED' || error.code === 'DOCUMENT_EXTRACTION_FAILED' || error.code === 'DOCUMENT_EMBEDDING_FAILED' || error.code === 'DOCUMENT_INSERT_FAILED' ? 500 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'CONTENT_INVALID_INPUT', message: 'Invalid upload request.' } }, 400);
      return c.json({ success: false, error: { code: 'DOCUMENT_PROCESSING_FAILED', message: 'Upload could not be completed.' } }, 500);
    }
  };
  return { reserve: (c: Context) => invoke(c, 'reserve'), complete: (c: Context) => invoke(c, 'complete') };
}

export const documentUploadHandlers = createDocumentUploadHandlers();
