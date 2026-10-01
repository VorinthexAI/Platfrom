import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, runTool } from '@/lib/ai/tools';
import { agentGreetingOccasionSchema } from '@/lib/ai/agents/greeting';
import { toolEventService } from '@/lib/ai/events/service';
import { issueOpeningGreetingToken } from '@/lib/conversations/opening-greeting';
import { newId } from '@/lib/ids';
import { getAuthIdentity } from './security';
import { authenticatedTeamContext } from './auth';
import { bindConversationStreamAbort } from './conversations';
import { parseJson, strictObject } from './validation';

const requestSchema = strictObject({ scopeKey: z.string().cuid(), occasion: agentGreetingOccasionSchema });

export async function generateAgentGreeting(c: Context) {
  try {
    const identity = await getAuthIdentity(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user authentication required' }, 403);
    const body = await parseJson(c, requestSchema);
    const { context } = await authorizeContentExecution({ scopeKey: body.scopeKey }, authenticatedTeamContext(identity));
    const correlationKey = newId(), messageKey = newId();
    return streamSSE(c, async (stream) => {
      const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
      try {
        const output = await runTool('agent.greet', '', { occasion: body.occasion }, {
          contentContext: context, requestKey: correlationKey, recordEvent: toolEventService.record,
          signal: abort.signal, timeoutMs: 45_000,
          onGreetingDelta: async (text) => {
            if (text && abort.active()) await stream.writeSSE({ event: 'delta', data: JSON.stringify({ type: 'delta', correlationKey, messageKey, text }), id: correlationKey });
          },
        }) as { greetingState: 'new-account' | 'returning'; message: string };
        if (!abort.active()) return;
        const persistenceToken = await issueOpeningGreetingToken({ key: messageKey, teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey: identity.key, occasion: body.occasion, greetingState: output.greetingState, message: output.message, guideTopicMode: output.greetingState === 'returning' ? 'explain' : 'recommend', guideTopics: { status: 'NONE' }, createdAt: new Date().toISOString() });
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ type: 'done', correlationKey, messageKey, message: output.message, persistenceToken }), id: correlationKey });
      } catch (error) {
        if (!abort.active()) return;
        console.error('agent greeting failed', { error });
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ type: 'error', correlationKey, code: 'FAILED', message: 'Greeting could not be generated.' }), id: correlationKey });
      } finally { abort.dispose(); }
    });
  } catch (error) {
    if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid greeting request' }, 400);
    console.error('greeting request failed', { error });
    return c.json({ success: false, error: 'greeting request failed' }, 500);
  }
}
