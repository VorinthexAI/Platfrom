import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError } from '@/lib/ai/tools';
import { personalAssistantInputSchema, runPersonalAssistant } from '@/lib/ai/personal-assistant/runtime';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const assistantRespondSchema = z.object({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), input: personalAssistantInputSchema }).strict();

export async function respondToAssistant(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ success: false, error: { code: 'ASSISTANT_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'ASSISTANT_FORBIDDEN', message: 'A user session is required.' } }, 403);
  try {
    const body = await parseJson(c, assistantRespondSchema);
    const { context } = await authorizeContentExecution({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, { authenticatedUserKey: identity.key });
    return c.json({ success: true, data: await runPersonalAssistant(body.input, context, {}) });
  } catch (error) {
    if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'ASSISTANT_INVALID_INPUT', message: 'Assistant request input was invalid.' } }, 400);
    return c.json({ success: false, error: { code: 'ASSISTANT_FAILED', message: 'Assistant request failed.' } }, 500);
  }
}
