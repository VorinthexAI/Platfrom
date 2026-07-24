import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { sanitizeAgentInput, streamTool, sanitizedAgentMessageSchema, type ToolDependencies } from '@/lib/ai/tools';
import { requireOrganizationAccess, FoundersAccessError } from '@/lib/founders/access';
import { ChorusError, ChorusService, type ChorusActor } from '@/lib/communication';
import { requireFounder } from './founders';
import { parseJson, parseQuery, strictObject } from './validation';

const key = z.string().cuid();
const organizationKey = z.string().trim().min(1).max(160);
const messageBody = strictObject({ content: sanitizedAgentMessageSchema, threadKey: key.optional(), replyToMessageKey: key.optional() });
const reactionBody = strictObject({ reaction: z.string().trim().min(1).max(64), operation: z.enum(['add', 'remove', 'toggle']).default('toggle') });
const threadBody = strictObject({ rootMessageKey: key, title: z.string().trim().min(1).max(200).optional() });
const replyBody = strictObject({ content: sanitizedAgentMessageSchema, replyToMessageKey: key.optional() });
const pollBody = strictObject({ messageKey: key, question: z.string().trim().min(1).max(500), options: z.array(z.string().trim().min(1).max(200)).min(2).max(20), allowMultiple: z.boolean().default(false) }).superRefine((poll, ctx) => {
  const normalized = poll.options.map((option) => option.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Poll options must be unique' });
});
const voteBody = strictObject({ optionKey: key });
export const chorusMessageListQuerySchema = strictObject({ limit: z.coerce.number().int().min(1).max(200).default(100) });

export interface ChorusApiDependencies {
  service: ChorusService;
  resolveActor(c: Context, requestedOrganizationKey: string): Promise<ChorusActor | Response>;
  stream(skill: string, input: { message: string; history: Array<{ role: 'user' | 'assistant'; content: string }> }, dependencies: ToolDependencies): AsyncIterable<{ type: string; text?: string }>;
}

const defaultDependencies: ChorusApiDependencies = {
  service: new ChorusService(),
  async resolveActor(c, requestedOrganizationKey) {
    const auth = await requireFounder(c);
    if ('error' in auth) return auth.error;
    try {
      const { membership } = await requireOrganizationAccess(auth.founder.user.key, requestedOrganizationKey);
      return { organizationKey: requestedOrganizationKey, membershipKey: membership.key };
    } catch (error) {
      if (error instanceof FoundersAccessError) return c.json({ error: 'organization access denied' }, 403);
      throw error;
    }
  },
  stream: (skill, input, dependencies) => streamTool('chat', skill, input, dependencies),
};

function statusFor(error: ChorusError): 403 | 404 | 409 {
  return error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 409;
}

function channelSummary(channel: { key: string; scopeKey: string; kind: string; name: string; description?: string; position: number; createdAt: string; updatedAt: string; archivedAt?: string; directOrchestratorKey?: string }) {
  return { key: channel.key, scopeKey: channel.scopeKey, kind: channel.kind, name: channel.name, description: channel.description, position: channel.position, directOrchestratorKey: channel.directOrchestratorKey, archivedAt: channel.archivedAt, createdAt: channel.createdAt, updatedAt: channel.updatedAt };
}

function storedMessage(message: { key: string; channelKey: string; threadKey?: string; replyToMessageKey?: string; content: string; createdAt: string; updatedAt: string }) {
  return { key: message.key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, createdAt: message.createdAt, updatedAt: message.updatedAt };
}

function threadProjection(thread: { key: string; channelKey: string; title?: string; rootMessageKey: string; status: string; createdAt: string; updatedAt: string }) {
  return { key: thread.key, channelKey: thread.channelKey, title: thread.title, rootMessageKey: thread.rootMessageKey, status: thread.status, createdAt: thread.createdAt, updatedAt: thread.updatedAt };
}

function boundedAssistantContent(content: string): string {
  const sanitized = sanitizeAgentInput(content);
  let bounded = '';
  for (const character of sanitized) {
    if (bounded.length + character.length > 8_000) break;
    bounded += character;
  }
  return bounded;
}

export function createChorusHandlers(dependencies: ChorusApiDependencies = defaultDependencies) {
  const activeChannels = new Set<string>();
  const actor = async (c: Context): Promise<ChorusActor | Response> => {
    const requested = organizationKey.parse(c.req.param('organizationKey'));
    return dependencies.resolveActor(c, requested);
  };
  const run = async (c: Context, action: (resolved: ChorusActor) => Promise<unknown>, created = false) => {
    const resolved = await actor(c);
    if (resolved instanceof Response) return resolved;
    try {
      const result = await action(resolved);
      return c.json(result, created ? 201 : 200);
    } catch (error) {
      if (error instanceof ChorusError) return c.json({ error: error.message }, statusFor(error));
      throw error;
    }
  };

  return {
    listChannels: (c: Context) => run(c, async (resolved) => ({ channels: (await dependencies.service.listDirectChannels(resolved)).map(({ orchestrator, channel, ...item }) => ({ ...item, orchestrator: { key: orchestrator.key, name: orchestrator.name, role: orchestrator.role }, channel: channel ? channelSummary(channel) : null })) })),
    openChannel: (c: Context) => run(c, async (resolved) => ({ channel: channelSummary((await dependencies.service.openDirectChannel(resolved, key.parse(c.req.param('orchestratorKey')))).channel) })),
    listMessages: (c: Context) => run(c, async (resolved) => ({ messages: await dependencies.service.listMessages(resolved, key.parse(c.req.param('channelKey')), parseQuery(c, chorusMessageListQuerySchema).limit) })),
    postMessage: async (c: Context) => {
      const resolved = await actor(c);
      if (resolved instanceof Response) return resolved;
      const channelKey = key.parse(c.req.param('channelKey'));
      const body = await parseJson(c, messageBody);
      if (activeChannels.has(channelKey)) return c.json({ error: 'a message is already being processed for this channel' }, 409);
      activeChannels.add(channelKey);
      let streamStarted = false;
      try {
        const { access, message } = await dependencies.service.persistUserMessage(resolved, channelKey, body.content, body.threadKey, body.replyToMessageKey);
        const history = await dependencies.service.history(access, body.threadKey, message.key);
        const provider = dependencies.stream(access.orchestrator.skill, { message: body.content, history }, { organizationKey: resolved.organizationKey, signal: c.req.raw.signal });
        const response = streamSSE(c, async (sse) => {
          streamStarted = true;
          let content = '';
          try {
            await sse.writeSSE({ event: 'start', data: JSON.stringify({ channelKey, userMessage: storedMessage(message) }) });
            for await (const chunk of provider) {
              if (chunk.type === 'text-delta' && chunk.text) {
                content += chunk.text;
                await sse.writeSSE({ event: 'token', data: JSON.stringify({ text: chunk.text }) });
              }
            }
            const storedContent = boundedAssistantContent(content);
            if (!storedContent) throw new Error('orchestrator returned no valid content');
            const assistantMessage = await dependencies.service.persistOrchestratorMessage(access, storedContent, body.threadKey, message.key);
            await sse.writeSSE({ event: 'done', data: JSON.stringify({ message: storedMessage(assistantMessage) }) });
          } catch (error) {
            console.error('chorus stream failed', { channelKey, error });
            await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'orchestrator stream failed' }) });
          } finally {
            activeChannels.delete(channelKey);
          }
        });
        return response;
      } catch (error) {
        if (!streamStarted) activeChannels.delete(channelKey);
        if (error instanceof ChorusError) return c.json({ error: error.message }, statusFor(error));
        throw error;
      }
    },
    react: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, reactionBody);
      return dependencies.service.react(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('messageKey')), body.reaction, body.operation);
    }),
    createThread: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, threadBody);
      return { thread: threadProjection(await dependencies.service.createThread(resolved, key.parse(c.req.param('channelKey')), body.rootMessageKey, body.title)) };
    }, true),
    readThread: (c: Context) => run(c, async (resolved) => { const result = await dependencies.service.readThread(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('threadKey'))); return { thread: threadProjection(result.thread), messages: result.messages }; }),
    replyThread: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, replyBody);
      return { message: storedMessage(await dependencies.service.replyThread(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('threadKey')), body.content, body.replyToMessageKey)) };
    }, true),
    resolveThread: (c: Context) => run(c, async (resolved) => ({ thread: threadProjection(await dependencies.service.resolveThread(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('threadKey')))) })),
    archiveThread: (c: Context) => run(c, async (resolved) => ({ thread: threadProjection(await dependencies.service.archiveThread(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('threadKey')))) })),
    createPoll: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, pollBody);
      return { poll: await dependencies.service.createPoll(resolved, key.parse(c.req.param('channelKey')), body.messageKey, body.question, body.options, body.allowMultiple) };
    }, true),
    readPoll: (c: Context) => run(c, async (resolved) => ({ poll: await dependencies.service.readPoll(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('pollKey'))) })),
    votePoll: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, voteBody);
      return { poll: await dependencies.service.votePoll(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('pollKey')), body.optionKey) };
    }),
    closePoll: (c: Context) => run(c, async (resolved) => ({ poll: await dependencies.service.closePoll(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('pollKey'))) })),
  };
}

export const chorusHandlers = createChorusHandlers();
