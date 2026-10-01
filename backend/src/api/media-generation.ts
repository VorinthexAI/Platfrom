import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { agentImageInputSchema, agentSpeechInputSchema, agentVideoInputSchema } from '@/lib/ai/agents/media';
import { authorizeContentExecution, ContentError, runTool } from '@/lib/ai/tools';
import { toolEventService } from '@/lib/ai/events/service';
import { getAuthIdentity } from './security';
import { authenticatedTeamContext } from './auth';
import { sparkErrorResponse } from './errors';
import { parseJson, strictObject } from './validation';

const modeSchema = z.enum(['image', 'speech', 'video']);
const bodySchema = strictObject({ scopeKey: z.string().cuid(), input: z.unknown() });
const inputs = { image: agentImageInputSchema, speech: agentSpeechInputSchema, video: agentVideoInputSchema } as const;

export async function generateMedia(c: Context) {
  const mode = modeSchema.safeParse(c.req.param('mode'));
  if (!mode.success) return c.json({ success: false, error: 'Unknown generation mode.' }, 400);
  try {
    const identity = await getAuthIdentity(c);
    if (!identity) return c.json({ success: false, error: 'Authentication required.' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'A user session is required.' }, 403);
    const body = await parseJson(c, bodySchema);
    const requestKey = z.string().trim().min(1).max(180).parse(c.req.header('idempotency-key'));
    const { context } = await authorizeContentExecution({ scopeKey: body.scopeKey }, authenticatedTeamContext(identity));
    const input = inputs[mode.data].parse(body.input);
    const output = await runTool(`agent.${mode.data}`, '', input, { contentContext: context, requestKey, recordEvent: toolEventService.record, signal: c.req.raw.signal, timeoutMs: 10 * 60_000 });
    return c.json({ success: true, data: output });
  } catch (error) {
    const billing = sparkErrorResponse(c, error); if (billing) return billing;
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'Invalid generation request.' }, 400);
    if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
    console.error('media generation failed', { mode: mode.data, error });
    return c.json({ success: false, error: 'Media generation failed.' }, 500);
  }
}
