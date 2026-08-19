import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { personalAssistantInputSchema, runPersonalAssistant, type PersonalAssistantDependencies } from '@/lib/ai/personal-assistant';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';

const requestSchema = strictObject({
  organizationKey: z.string().trim().min(1),
  scopeKey: z.string().cuid(),
  input: personalAssistantInputSchema,
});
const MAX_ASSISTANT_REQUEST_BYTES = 128 * 1024;

class AssistantRequestTooLargeError extends Error {}

async function parseRequest(c: Context) {
  const declared = c.req.header('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_ASSISTANT_REQUEST_BYTES)) throw new AssistantRequestTooLargeError();
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new SyntaxError('Request body is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ASSISTANT_REQUEST_BYTES) { await reader.cancel(); throw new AssistantRequestTooLargeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return requestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export interface PersonalAssistantHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: typeof authorizeContentExecution;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  run?: typeof runPersonalAssistant;
  runtime?: PersonalAssistantDependencies;
}

export function createPersonalAssistantHandler(dependencies: PersonalAssistantHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: { code: 'ASSISTANT_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'ASSISTANT_FORBIDDEN', message: 'A user session is required.' } }, 403);
    let body: z.output<typeof requestSchema>;
    try { body = await parseRequest(c); }
    catch (error) {
      if (error instanceof AssistantRequestTooLargeError) return c.json({ success: false, error: { code: 'ASSISTANT_REQUEST_TOO_LARGE', message: 'Assistant request is too large.' } }, 413);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'ASSISTANT_INVALID_INPUT', message: 'Assistant request input was invalid.' } }, 400);
      throw error;
    }
    try {
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({
        organizationKey: body.organizationKey,
        scopeKey: body.scopeKey,
      }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
      const output = await (dependencies.run ?? runPersonalAssistant)(body.input, context, {
        ...dependencies.runtime,
        router: { ...dependencies.runtime?.router, signal: c.req.raw.signal },
      });
      return c.json({ success: true, data: output });
    } catch (error) {
      if (error instanceof ContentError && error.code === 'CONTENT_FORBIDDEN') {
        return c.json({ success: false, error: { code: 'ASSISTANT_FORBIDDEN', message: 'Assistant execution access denied.' } }, 403);
      }
      console.error('personal assistant execution failed', {
        organizationKey: body.organizationKey,
        scopeKey: body.scopeKey,
        surface: body.input.surface,
        error,
      });
      return c.json({ success: false, error: { code: 'ASSISTANT_EXECUTION_FAILED', message: 'Assistant execution failed.' } }, 500);
    }
  };
}

export const postPersonalAssistantResponse = createPersonalAssistantHandler();
