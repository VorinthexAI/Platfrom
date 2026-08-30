import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { appSpeechCapability } from '@/lib/ai/personal-assistant/service-capabilities';
import type { AppSpeechService } from '@/lib/app-speech/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const contextSchema = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), input: appSpeechCapability.inputSchema }).strict();

interface AppSpeechHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ input: { organizationKey: string; scopeKey: string }; context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: AppSpeechService;
}

export function createAppSpeechHandler(dependencies: AppSpeechHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
    try {
      const body = await parseJson(c, contextSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
      const result = await appSpeechCapability.execute(body.input, { domain: context, appSpeech: dependencies.service, signal: c.req.raw.signal, timeoutMs: 4 * 60_000 });
      if (result.kind !== 'continue') throw new Error('App speech returned an unsupported result.');
      return c.json({ success: true, data: result.result });
    } catch (error) {
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid app speech request' }, 400);
      return c.json({ success: false, error: 'app speech failed' }, 500);
    }
  };
}

export const appSpeechHandler = createAppSpeechHandler();
