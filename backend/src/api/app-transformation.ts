import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { appEnhanceCapability, appTranslateCapability } from '@/lib/ai/personal-assistant/service-capabilities';
import type { AssistantCapabilityContext } from '@/lib/ai/personal-assistant/capabilities';
import type { AppTransformationService } from '@/lib/app-transformation/service';
import type { EmailService } from '@/lib/email-inbox/service';
import { EmailIdempotencyError, EmailRepositoryError } from '@/lib/email-inbox/service';
import { FoundersAccessError } from '@/lib/founders/access';
import type { ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const contextSchema = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() }).strict();

interface AppTransformationHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ input: { organizationKey: string; scopeKey: string }; context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: AppTransformationService;
  email?: EmailService;
  content?: ContentToolDependencies;
  executeContent?: AssistantCapabilityContext['executeContent'];
}

function createHandler(capability: typeof appEnhanceCapability | typeof appTranslateCapability, dependencies: AppTransformationHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
    try {
      const body = await parseJson(c, contextSchema.extend({ input: capability.inputSchema }).strict());
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, {
        ...dependencies.authorizationOptions,
        authenticatedUserKey: identity.key,
      });
      const result = await capability.execute(body.input, {
        domain: context,
        requestKey: c.req.header('idempotency-key')?.trim() ? z.string().min(1).max(200).parse(c.req.header('idempotency-key')!.trim()) : undefined,
        appTransformation: dependencies.service,
        email: dependencies.email,
        contentDependencies: dependencies.content,
        executeContent: dependencies.executeContent,
        signal: c.req.raw.signal,
        timeoutMs: 4 * 60_000,
      });
      if (result.kind !== 'continue') throw new Error('App transformation returned an unsupported result.');
      return c.json({ success: true, data: result.result });
    } catch (error) {
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
      if (error instanceof FoundersAccessError) return c.json({ success: false, error: 'app transformation access denied' }, 403);
      if (error instanceof EmailIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message, retryable: error.retryable } }, 409);
      if (error instanceof EmailRepositoryError) return c.json({ success: false, error: error.message }, error.reason === 'not_found' ? 404 : error.reason === 'forbidden' ? 403 : 409);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid app transformation request' }, 400);
      return c.json({ success: false, error: 'app transformation failed' }, 500);
    }
  };
}

export function createAppTransformationHandlers(dependencies: AppTransformationHandlerDependencies = {}) {
  return {
    enhance: createHandler(appEnhanceCapability, dependencies),
    translate: createHandler(appTranslateCapability, dependencies),
  };
}

export const appTransformationHandlers = createAppTransformationHandlers();
