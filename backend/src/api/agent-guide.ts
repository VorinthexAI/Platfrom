import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import { agentGreetingOccasionSchema } from '@/lib/ai/agents/greeting';
import { authorizeContentExecution, ContentError, runTool, type ToolContext } from '@/lib/ai/tools';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { newId } from '@/lib/ids';
import { authenticatedTeamContext } from './auth';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';
import { issueOpeningGreetingToken, verifyOpeningGreetingToken } from '@/lib/conversations/opening-greeting';
import { bindConversationStreamAbort } from './conversations';

const greetingRequestSchema = strictObject({
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  occasion: agentGreetingOccasionSchema,
});
const greetingTopicsRequestSchema = strictObject({
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  persistenceToken: z.string().min(1).max(20_000),
});
const greetingTopicSchema = z.object({ key: z.string().trim().min(1).max(180), label: z.string().trim().min(1).max(120), question: z.string().trim().min(1).max(2_000) }).strict();
const greetingTopicsSchema = z.array(greetingTopicSchema).length(3).refine((topics) => new Set(topics.map(({ key }) => key)).size === topics.length && new Set(topics.map(({ label }) => label.toLocaleLowerCase())).size === topics.length && new Set(topics.map(({ question }) => question.toLocaleLowerCase())).size === topics.length, 'Guide topics must be unique.');

export const greetingDeltaEventSchema = z.object({ type: z.literal('delta'), correlationKey: z.string().min(1), messageKey: z.string().cuid(), text: z.string().min(1) }).strict();
export const greetingDoneEventSchema = z.object({ type: z.literal('done'), correlationKey: z.string().min(1), messageKey: z.string().cuid(), message: z.string().trim().min(1).max(500), showReferralCodeAction: z.boolean(), topicsPending: z.boolean(), persistenceToken: z.string().min(1).max(20_000) }).strict();
export const greetingTopicEventSchema = z.object({ type: z.literal('topic'), correlationKey: z.string().min(1), topic: greetingTopicSchema }).strict();
export const greetingTopicsDoneEventSchema = z.object({ type: z.literal('done'), correlationKey: z.string().min(1), topics: greetingTopicsSchema, persistenceToken: z.string().min(1).max(20_000) }).strict();
export const greetingErrorEventSchema = z.object({ type: z.literal('error'), correlationKey: z.string().min(1), code: z.string().min(1), message: z.string().min(1) }).strict();

type GuideRunDependencies = {
  contentContext: ToolContext;
  requestKey: string;
  recordEvent: ToolEventRecorder;
  signal: AbortSignal;
  timeoutMs: number;
  onGreetingDelta?: (text: string) => void | Promise<void>;
  onGuideTopic?: (topic: z.infer<typeof greetingTopicSchema>) => void | Promise<void>;
};

interface AgentGreetingHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { teamKey: string; scopeKey: string }, options: { authenticatedUserKey: string; teamAssurance?: ToolContext['teamAssurance'] }) => Promise<{ context: ToolContext }>;
  run?: (name: 'agent.guide', skill: string, input: unknown, dependencies: GuideRunDependencies) => Promise<unknown>;
  recordEvent?: ToolEventRecorder;
  id?: () => string;
  now?: () => string;
  issueGreetingToken?: typeof issueOpeningGreetingToken;
  verifyGreetingToken?: typeof verifyOpeningGreetingToken;
}

function initialFailure(c: Context, error: unknown, request: string) {
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: `invalid ${request} request` }, 400);
  console.error(`${request} request failed`, { error });
  return c.json({ success: false, error: `${request} request failed` }, 500);
}

export function createAgentGreetingHandler(dependencies: AgentGreetingHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
      if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: 'user authentication required' }, 403);
      const body = await parseJson(c, greetingRequestSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey: body.teamKey, scopeKey: body.scopeKey }, authenticatedTeamContext(identity));
      const makeId = dependencies.id ?? newId;
      const correlationKey = makeId(), messageKey = makeId();
      return streamSSE(c, async (stream) => {
        const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
        let terminal = false;
        try {
          const output = await (dependencies.run ?? runTool)('agent.guide', '', { mode: 'greet', occasion: body.occasion }, {
            contentContext: context,
            requestKey: correlationKey,
            recordEvent: dependencies.recordEvent ?? toolEventService.record,
            signal: abort.signal,
            timeoutMs: 45_000,
            onGreetingDelta: async (text) => {
              if (!text || !abort.active()) return;
              const event = greetingDeltaEventSchema.parse({ type: 'delta', correlationKey, messageKey, text });
              await stream.writeSSE({ event: 'delta', data: JSON.stringify(event), id: correlationKey });
            },
          }) as { greetingState: 'referral-onboarding' | 'new-account' | 'returning'; message: string; showReferralCodeAction: boolean; guideMode: 'recommend' | 'explain' };
          if (!abort.active()) return;
          const createdAt = (dependencies.now ?? (() => new Date().toISOString()))();
          const persistenceToken = await (dependencies.issueGreetingToken ?? issueOpeningGreetingToken)({ key: messageKey, teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, userKey: identity.key, occasion: body.occasion, greetingState: output.greetingState, message: output.message, guideTopicMode: output.guideMode, guideTopics: { status: 'NONE' }, createdAt });
          if (!abort.active()) return;
          const event = greetingDoneEventSchema.parse({ type: 'done', correlationKey, messageKey, message: output.message, showReferralCodeAction: output.showReferralCodeAction, topicsPending: !output.showReferralCodeAction, persistenceToken });
          terminal = true;
          await stream.writeSSE({ event: 'done', data: JSON.stringify(event), id: correlationKey });
        } catch (error) {
          if (!abort.active() || terminal) return;
          console.error('agent greeting stream failed', { correlationKey, error });
          const event = greetingErrorEventSchema.parse({ type: 'error', correlationKey, code: error instanceof ContentError ? error.code : 'FAILED', message: 'Agent greeting failed.' });
          terminal = true;
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
        } finally { abort.dispose(); }
      });
    } catch (error) { return initialFailure(c, error, 'agent greeting'); }
  };
}

export function createAgentGreetingTopicsHandler(dependencies: AgentGreetingHandlerDependencies = {}) {
  return async (c: Context) => {
    try {
      const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
      if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: 'user authentication required' }, 403);
      const body = await parseJson(c, greetingTopicsRequestSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey: body.teamKey, scopeKey: body.scopeKey }, authenticatedTeamContext(identity));
      const opening = await (dependencies.verifyGreetingToken ?? verifyOpeningGreetingToken)(body.persistenceToken);
      if (!opening || opening.teamKey !== context.teamKey || opening.scopeKey !== context.runtimeScopeKey || opening.userKey !== identity.key || opening.guideTopics.status !== 'NONE' || opening.greetingState === 'referral-onboarding') return c.json({ success: false, error: 'opening greeting is invalid or expired' }, 403);
      const correlationKey = (dependencies.id ?? newId)();
      return streamSSE(c, async (stream) => {
        const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
        let terminal = false;
        try {
          const output = await (dependencies.run ?? runTool)('agent.guide', '', { mode: 'opening-topics', greetingState: opening.greetingState, message: opening.message }, {
            contentContext: context,
            requestKey: correlationKey,
            recordEvent: dependencies.recordEvent ?? toolEventService.record,
            signal: abort.signal,
            timeoutMs: 45_000,
            onGuideTopic: async (topic) => {
              if (!abort.active()) return;
              const event = greetingTopicEventSchema.parse({ type: 'topic', correlationKey, topic });
              await stream.writeSSE({ event: 'topic', data: JSON.stringify(event), id: correlationKey });
            },
          }) as { guideMode: 'recommend' | 'explain'; topics: unknown[] };
          if (!abort.active()) return;
          const topics = greetingTopicsSchema.parse(output.topics);
          const persistenceToken = await (dependencies.issueGreetingToken ?? issueOpeningGreetingToken)({ key: opening.key, teamKey: opening.teamKey, scopeKey: opening.scopeKey, userKey: opening.userKey, occasion: opening.occasion, greetingState: opening.greetingState, message: opening.message, guideTopicMode: output.guideMode, guideTopics: { status: 'READY', topics }, createdAt: opening.createdAt });
          if (!abort.active()) return;
          const event = greetingTopicsDoneEventSchema.parse({ type: 'done', correlationKey, topics, persistenceToken });
          terminal = true;
          await stream.writeSSE({ event: 'done', data: JSON.stringify(event), id: correlationKey });
        } catch (error) {
          if (!abort.active() || terminal) return;
          console.error('agent greeting topics stream failed', { correlationKey, error });
          const event = greetingErrorEventSchema.parse({ type: 'error', correlationKey, code: error instanceof ContentError ? error.code : 'FAILED', message: 'Agent greeting topics failed.' });
          terminal = true;
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
        } finally { abort.dispose(); }
      });
    } catch (error) { return initialFailure(c, error, 'agent greeting topics'); }
  };
}

export const generateAgentGreeting = createAgentGreetingHandler();
export const generateAgentGreetingTopics = createAgentGreetingTopicsHandler();
