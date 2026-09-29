import type { Context } from 'hono';
import { ZodError } from 'zod';
import { authorizeContentExecution, ContentError } from '@/lib/ai/tools';
import { completeDocumentUpload, documentUploadCompleteSchema, documentUploadReserveSchema, DocumentUploadError, reserveDocumentUpload } from '@/lib/ai/document-processing/direct-upload';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { sparkErrorResponse } from './errors';

export function createDocumentUploadHandlers() {
  const invoke = async (c: Context, operation: 'reserve' | 'complete') => {
    try {
      const body = await parseJson(c, operation === 'reserve' ? documentUploadReserveSchema : documentUploadCompleteSchema);
      const identity = await getAuthIdentity(c);
      if (!identity) return c.json({ success: false, error: { code: 'CONTENT_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'CONTENT_FORBIDDEN', message: 'User session required.' } }, 403);
      const { context } = await authorizeContentExecution({ scopeKey: body.scopeKey }, { authenticatedUserKey: identity.key });
      if (operation === 'reserve') return c.json({ success: true, data: await reserveDocumentUpload(documentUploadReserveSchema.parse(body), context) }, 201);
      return c.json({ success: true, data: await completeDocumentUpload(documentUploadCompleteSchema.parse(body), context) });
    } catch (error) {
      const billing = sparkErrorResponse(c, error); if (billing) return billing;
      if (error instanceof DocumentUploadError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : error.code === 'CONTENT_UNAUTHORIZED' ? 401 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'CONTENT_INVALID_INPUT', message: 'Invalid upload request.' } }, 400);
      return c.json({ success: false, error: { code: 'DOCUMENT_PROCESSING_FAILED', message: 'Upload could not be completed.' } }, 500);
    }
  };
  return { reserve: (c: Context) => invoke(c, 'reserve'), complete: (c: Context) => invoke(c, 'complete') };
}

export const documentUploadHandlers = createDocumentUploadHandlers();
