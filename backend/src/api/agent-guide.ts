import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { agentGreetingOccasionSchema } from '@/lib/ai/agents/greeting';
import { authorizeContentExecution, ContentError, runTool, type ToolContext } from '@/lib/ai/tools';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { newId } from '@/lib/ids';
import { authenticatedTeamContext } from './auth';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const greetingRequestSchema = strictObject({
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  occasion: agentGreetingOccasionSchema,
});
const greetingResponseSchema = z.object({ message: z.string().trim().min(1).max(500), showReferralCodeAction: z.boolean() }).strict();

interface AgentGreetingHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { teamKey: string; scopeKey: string }, options: { authenticatedUserKey: string; teamAssurance?: ToolContext['teamAssurance'] }) => Promise<{ context: ToolContext }>;
  run?: (name: 'agent.guide', skill: string, input: unknown, dependencies: { contentContext: ToolContext; requestKey: string; recordEvent: ToolEventRecorder; signal: AbortSignal; timeoutMs: number }) => Promise<unknown>;
  recordEvent?: ToolEventRecorder;
  id?: () => string;
}

export function createAgentGreetingHandler(dependencies: AgentGreetingHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
      if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: 'user authentication required' }, 403);
      const body = await parseJson(c, greetingRequestSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey: body.teamKey, scopeKey: body.scopeKey }, authenticatedTeamContext(identity));
      const output = await (dependencies.run ?? runTool)('agent.guide', '', { mode: 'greet', occasion: body.occasion }, {
        contentContext: context,
        requestKey: (dependencies.id ?? newId)(),
        recordEvent: dependencies.recordEvent ?? toolEventService.record,
        signal: c.req.raw.signal,
        timeoutMs: 45_000,
       }) as { message: string; showReferralCodeAction: boolean };
       return c.json({ success: true, data: greetingResponseSchema.parse({ message: output.message, showReferralCodeAction: output.showReferralCodeAction }) });
    } catch (error) {
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid agent greeting request' }, 400);
      console.error('agent greeting request failed', { error });
      return c.json({ success: false, error: 'agent greeting request failed' }, 500);
    }
  };
}

export const generateAgentGreeting = createAgentGreetingHandler();
