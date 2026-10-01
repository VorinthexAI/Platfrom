import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { ContentError, contentToolInputSchemas, contentToolNameSchema, isContentMutation, runAuthenticatedContentTool } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { sparkErrorResponse } from './errors';
import { toolEventService } from '@/lib/ai/events/service';

const bodySchema = strictObject({ scopeKey: z.string().cuid(), input: z.unknown() });

function responseError(error: ContentError) { return { success: false as const, error: error.toJSON() }; }

export async function invokeContentTool(c: Context) {
  const rawTool = c.req.param('tool');
  let tool: z.infer<typeof contentToolNameSchema>;
  try { tool = contentToolNameSchema.parse(rawTool); }
  catch { return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Unknown Content tool.', rawTool || 'unknown', { action: 'parse' })), 400); }
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json(responseError(new ContentError('CONTENT_UNAUTHORIZED', 'Authentication required.', tool, { action: 'authorization' })), 401);
  if (identity.identityType !== 'user') return c.json(responseError(new ContentError('CONTENT_FORBIDDEN', 'A user session is required.', tool, { action: 'authorization' })), 403);
  try {
    const body = await parseJson(c, bodySchema);
    let input = contentToolInputSchemas[tool].parse(body.input);
    const idempotencyKey = c.req.header('idempotency-key')?.trim();
    if (isContentMutation(tool, input) && idempotencyKey && input && typeof input === 'object' && !Array.isArray(input)) input = { ...input, idempotencyKey } as unknown as typeof input;
    const output = await runAuthenticatedContentTool({ scopeKey: body.scopeKey, tool, input }, { authenticatedUserKey: identity.key, recordEvent: toolEventService.record, ...(idempotencyKey ? { requestKey: idempotencyKey } : {}) });
    return c.json({ success: true, data: output });
  } catch (error) {
    const billing = sparkErrorResponse(c, error); if (billing) return billing;
    if (error instanceof ContentError) return c.json(responseError(error), error.code === 'CONTENT_FORBIDDEN' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json(responseError(new ContentError('CONTENT_INVALID_INPUT', 'Content request input was invalid.', tool, { action: 'parse' })), 400);
    return c.json(responseError(new ContentError('DOCUMENT_PROCESSING_FAILED', 'Content tool invocation failed.', tool, { action: 'execute' })), 500);
  }
}
