import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError } from '@/lib/ai/tools';
import { personalAssistantInputSchema, runPersonalAssistant } from '@/lib/ai/personal-assistant/runtime';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { sparkErrorResponse } from './errors';
import { toolEventService } from '@/lib/ai/events/service';
import { observeToolExecution } from '@/lib/ai/events/runtime';
import { createHash } from 'node:crypto';

const assistantRespondSchema = z.object({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), input: personalAssistantInputSchema }).strict();

export async function respondToAssistant(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ success: false, error: { code: 'ASSISTANT_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  if (identity.identityType !== 'user') return c.json({ success: false, error: { code: 'ASSISTANT_FORBIDDEN', message: 'A user session is required.' } }, 403);
  try {
    const body = await parseJson(c, assistantRespondSchema);
    const { context } = await authorizeContentExecution({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, { authenticatedUserKey: identity.key });
    const requestKey = body.input.requestKey ?? createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const input = { ...body.input, requestKey };
    return c.json({ success: true, data: await observeToolExecution(
      'agents.core',
      context,
      () => runPersonalAssistant(input, context, { recordEvent: toolEventService.record }),
      { recorder: toolEventService.record, idempotencyKey: requestKey, input },
    ) });
  } catch (error) {
    const billing = sparkErrorResponse(c, error); if (billing) return billing;
    if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'ASSISTANT_INVALID_INPUT', message: 'Assistant request input was invalid.' } }, 400);
    return c.json({ success: false, error: { code: 'ASSISTANT_FAILED', message: 'Assistant request failed.' } }, 500);
  }
}
