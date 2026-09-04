import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createImageGenerationService, imageGenerateModelInputSchema, imageGenerationHistoryDeleteInputSchema, ImageGenerationAccessError, ImageGenerationIdempotencyError, ImageGenerationReferenceError, type ImageGenerationService } from '@/lib/image-generation/service';
import { getAuthIdentity } from './security';
import { parseJson, parseQuery } from './validation';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { sparkErrorResponse } from './errors';

const selectors = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() }).strict();
export const imageGenerateHttpInputSchema = selectors.extend(imageGenerateModelInputSchema.shape).strict();
export const imageGenerationHistoryListHttpInputSchema = selectors.extend({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const imageGenerationHistoryDeleteHttpInputSchema = selectors.extend(imageGenerationHistoryDeleteInputSchema.shape).strict();
const idempotencyKeySchema = z.string().trim().min(1).max(256);

export interface ImageGenerationHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: ImageGenerationService;
  createService?: typeof createImageGenerationService;
  recordEvent?: ToolEventRecorder;
  billing?: ToolBillingDependencies;
}

async function authorized(c: Context, dependencies: ImageGenerationHandlerDependencies, organizationKey: string, scopeKey: string) {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return { response: c.json({ success: false, error: 'authentication required' }, 401) };
  if (identity.identityType !== 'user') return { response: c.json({ success: false, error: 'user session required' }, 403) };
  const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey, scopeKey }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
  return { context };
}

function failure(c: Context, error: unknown) {
  const billing = sparkErrorResponse(c, error); if (billing) return billing;
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid image generation request' }, 400);
  if (error instanceof ImageGenerationAccessError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 403);
  if (error instanceof ImageGenerationReferenceError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 400);
  if (error instanceof ImageGenerationIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message, retryable: error.retryable } }, error.code === 'IMAGE_IDEMPOTENCY_PENDING' || error.code === 'IMAGE_IDEMPOTENCY_CONFLICT' ? 409 : 400);
  console.error('image generation request failed', { error });
  return c.json({ success: false, error: 'image generation request could not be completed' }, 500);
}

function service(c: Context, dependencies: ImageGenerationHandlerDependencies) { return dependencies.service ?? (dependencies.createService ?? createImageGenerationService)({ signal: c.req.raw.signal }); }

export function createImageGenerateHandler(dependencies: ImageGenerationHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const requestKey = idempotencyKeySchema.parse(c.req.header('idempotency-key'));
      const { organizationKey, scopeKey, ...input } = await parseJson(c, imageGenerateHttpInputSchema);
      const result = await authorized(c, dependencies, organizationKey, scopeKey);
      if ('response' in result) return result.response;
      const data = await observeToolExecution('image.generate', result.context, () => service(c, dependencies).generate(input, result.context, requestKey), { recorder: dependencies.recordEvent ?? toolEventService.record, idempotencyKey: requestKey, input, ...dependencies.billing });
      return c.json({ success: true, data }, 201);
    } catch (error) { return failure(c, error); }
  };
}

export function createImageGenerationHistoryListHandler(dependencies: ImageGenerationHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const { organizationKey, scopeKey, ...input } = parseQuery(c, imageGenerationHistoryListHttpInputSchema);
      const result = await authorized(c, dependencies, organizationKey, scopeKey);
      if ('response' in result) return result.response;
      return c.json({ success: true, data: await service(c, dependencies).listHistory(input, result.context) });
    } catch (error) { return failure(c, error); }
  };
}

export function createImageGenerationHistoryDeleteHandler(dependencies: ImageGenerationHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const { organizationKey, scopeKey, ...input } = await parseJson(c, imageGenerationHistoryDeleteHttpInputSchema);
      const result = await authorized(c, dependencies, organizationKey, scopeKey);
      if ('response' in result) return result.response;
      return c.json({ success: true, data: await service(c, dependencies).deleteHistory(input, result.context) });
    } catch (error) { return failure(c, error); }
  };
}

export const generateImage = createImageGenerateHandler();
export const listImageGenerationHistory = createImageGenerationHistoryListHandler();
export const deleteImageGenerationHistory = createImageGenerationHistoryDeleteHandler();
