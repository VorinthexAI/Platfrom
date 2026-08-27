import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { appAudioCapability } from '@/lib/ai/personal-assistant/service-capabilities';
import type { AppAudioService } from '@/lib/app-audio/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const contextSchema = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), input: appAudioCapability.inputSchema }).strict();

interface AppAudioHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ input: { organizationKey: string; scopeKey: string }; context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: AppAudioService;
}

export function createAppAudioHandler(dependencies: AppAudioHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
    try {
      const body = await parseJson(c, contextSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
      const result = await appAudioCapability.execute(body.input, { domain: context, appAudio: dependencies.service, signal: c.req.raw.signal, timeoutMs: 4 * 60_000 });
      if (result.kind !== 'continue') throw new Error('App audio returned an unsupported result.');
      return c.json({ success: true, data: result.result });
    } catch (error) {
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid app audio request' }, 400);
      return c.json({ success: false, error: 'app audio failed' }, 500);
    }
  };
}

export const appAudioHandler = createAppAudioHandler();
