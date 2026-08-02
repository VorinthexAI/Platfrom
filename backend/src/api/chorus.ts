import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { streamTool, transcribeTool, sanitizedAgentMessageSchema, type ToolDependencies } from '@/lib/ai/tools';
import { executeAction } from '@/lib/ai/router';
import type { SpeechOutput, TranscriptionOutput } from '@/lib/ai/providers';
import { dedupeMentionCandidates } from '@/lib/communication/mention-candidates';
import { getDefaultScopeRepository } from '@/lib/ai/scopes';
import { listAccessibleScopes, requireOrganizationAccess, FoundersAccessError } from '@/lib/founders/access';
import { getUserOrganizationById } from '@/lib/db/user-organization.node';
import { ChorusError, ChorusService, type ChorusActor } from '@/lib/communication';
import { requireFounder } from './founders';
import { parseJson, parseQuery, strictObject } from './validation';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import type { MentionCandidate } from '@/lib/communication/repository';
import { publishChorusTyping, subscribeChorusTyping, type ChorusTypingEvent } from '@/lib/communication/typing';

// Chorus identifiers are public application keys. Legacy organization records
// may use stable opaque keys rather than generated CUIDs.
const key = z.string().trim().min(1).max(160);
const organizationKey = z.string().trim().min(1).max(160);
const messageBody = strictObject({ content: sanitizedAgentMessageSchema, threadKey: key.optional(), replyToMessageKey: key.optional() });
const editMessageBody = strictObject({ content: sanitizedAgentMessageSchema });
const reactionBody = strictObject({ reaction: z.string().trim().min(1).max(64), operation: z.enum(['add', 'remove', 'toggle']).default('toggle') });
const typingBody = strictObject({ active: z.boolean() });
const pollBody = strictObject({ messageKey: key, question: z.string().trim().min(1).max(500), options: z.array(z.string().trim().min(1).max(200)).min(2).max(20), allowMultiple: z.boolean().default(false) }).superRefine((poll, ctx) => {
  const normalized = poll.options.map((option) => option.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Poll options must be unique' });
});
const voteBody = strictObject({ optionKey: key });
const transcriptionBody = strictObject({
  audioBase64: z.string().min(1).max(4_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  mimeType: z.literal('audio/pcm'),
}).superRefine((input, ctx) => {
  const bytes = Buffer.from(input.audioBase64, 'base64').byteLength;
  if (bytes < 960 || bytes > 2_880_000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audioBase64'], message: 'Audio must be between 20ms and 60 seconds' });
});
const speechBody = strictObject({ text: z.string().trim().min(1).max(8_000) });
const CHORUS_RESPONSE_INSTRUCTION = `Reply directly to the user with a detailed, self-contained plain-text answer. Other orchestrator mentions only select independent recipients: do not address, converse with, or refer to other mentioned orchestrators or their responses. Explain the relevant reasoning, assumptions, tradeoffs, and practical next steps when useful. Use no Markdown, headings, bullets, numbering, emphasis markers, or preamble. Keep the complete response under 500 words.`;
const CHORUS_PROVIDER_FALLBACK = 'I could not generate a response right now. Please try again.';
const CHORUS_PARTIAL_FALLBACK = '\n\nI could not complete this response. Please try again.';
export const chorusMessageListQuerySchema = strictObject({ limit: z.coerce.number().int().min(1).max(200).default(100) });

export interface ChorusApiDependencies {
  service: ChorusService;
  resolveActor(c: Context, requestedOrganizationKey: string): Promise<ChorusActor | Response>;
  stream(skill: string, input: { message: string }, dependencies: ToolDependencies): AsyncIterable<{ type: string; text?: string }>;
  listScopes(actor: ChorusActor): Promise<readonly { name: string; description: string | null }[]>;
  publishTyping?(event: ChorusTypingEvent): Promise<void>;
  subscribeTyping?(listener: (event: ChorusTypingEvent) => void): () => void;
  transcribe(organizationKey: string, audioBase64: string, prompt: string, signal: AbortSignal): Promise<TranscriptionOutput>;
  speak(organizationKey: string, text: string, signal: AbortSignal): Promise<SpeechOutput>;
}

const defaultDependencies: ChorusApiDependencies = {
  service: new ChorusService(),
  async resolveActor(c, requestedOrganizationKey) {
    const auth = await requireFounder(c);
    if ('error' in auth) return auth.error;
    try {
      const { membership } = await requireOrganizationAccess(auth.founder.user.key, requestedOrganizationKey);
      return { organizationKey: requestedOrganizationKey, membershipKey: membership.key, name: auth.founder.user.name ?? auth.founder.user.alias ?? auth.founder.user.email.split('@')[0] ?? 'Member' };
    } catch (error) {
      if (error instanceof FoundersAccessError) return c.json({ error: 'organization access denied' }, 403);
      throw error;
    }
  },
  stream: (skill, input, dependencies) => streamTool('chat', skill, input, dependencies),
  async listScopes(actor) {
    const membership = await getUserOrganizationById(actor.membershipKey);
    if (!membership || membership.organizationId !== actor.organizationKey || membership.status !== 'active') return [];
    const accessibleKeys = new Set((await listAccessibleScopes(membership)).map(({ key: scopeKey }) => scopeKey));
    return (await getDefaultScopeRepository().listScopes(actor.organizationKey)).filter((scope) => accessibleKeys.has(scope.key));
  },
  publishTyping: publishChorusTyping,
  subscribeTyping: subscribeChorusTyping,
  transcribe: (organizationKey, audioBase64, prompt, signal) => transcribeTool.execute(
    { audioBase64, mimeType: 'audio/pcm', prompt },
    { organizationKey, signal, timeoutMs: 90_000 },
  ),
  speak: async (organizationKey, text, signal) => (await executeAction<unknown, SpeechOutput>({ mode: 'fixed', organizationKey, actionSlug: 'speak', modelSlug: 'openai.gpt-realtime-2', providerSlug: 'openai' }, { text, voice: 'ash', format: 'wav' }, { signal, timeoutMs: 90_000 })).output,
};

function statusFor(error: ChorusError): 403 | 404 | 409 {
  return error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 409;
}

function channelSummary(channel: { key: string; organizationKey: string; scopeKey: string; kind: string; name: string; description?: string; position: number; createdAt: string; updatedAt: string; archivedAt?: string }) {
  return { key: channel.key, organizationKey: channel.organizationKey, scopeKey: channel.scopeKey, kind: channel.kind, name: channel.name, description: channel.description, position: channel.position, archivedAt: channel.archivedAt, createdAt: channel.createdAt, updatedAt: channel.updatedAt };
}

function storedMessage(message: { key: string; channelKey: string; threadKey?: string; replyToMessageKey?: string; content: string; editedAt?: string; createdAt: string; updatedAt: string }) {
  return { key: message.key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, editedAt: message.editedAt, createdAt: message.createdAt, updatedAt: message.updatedAt };
}

function boundedAssistantDelta(content: string, delta: string): string {
  let accepted = '';
  for (const character of delta) {
    if (content.length + accepted.length + character.length > 8_000) break;
    accepted += character;
  }
  return accepted;
}

function requestWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function scopeContext(scopes: readonly { name: string; description: string | null }[]): string {
  const descriptions = scopes
    .filter((scope) => scope.description?.trim())
    .map((scope) => `${scope.name}: ${scope.description!.trim()}`);
  return descriptions.length ? `## Organization scopes\n${descriptions.join('\n')}` : '';
}

function responseIdentity(name: string, role?: string): string {
  const identity = role?.trim() ? `${name}, the ${role.trim()} orchestrator` : `${name}, an orchestrator`;
  return `## Current response identity\nYou are ${identity}. This invocation belongs only to ${name}. Speak in first person from your own perspective and treat the user's request as addressed solely to you. Any other orchestrator mentions are routing metadata, not participants in your conversation. Ignore them completely: do not greet, address, describe, coordinate with, speak for, or refer to another orchestrator. Do not describe yourself in the third person or answer on behalf of a group.`;
}

function mentionsCanonicalOrchestrator(content: string): boolean {
  return CANONICAL_ORCHESTRATOR_NAMES.some((name) => new RegExp(`(^|[^\\w])@${name}(?=$|[^\\w])`, 'i').test(content));
}

export function orchestratorPromptMessage(content: string, orchestrators: readonly Pick<MentionCandidate, 'key' | 'name'>[]): string {
  const uniqueOrchestrators = [...new Map(orchestrators.map((orchestrator) => [orchestrator.key, orchestrator])).values()];
  if (uniqueOrchestrators.length < 2) return content;
  const names = uniqueOrchestrators.map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((left, right) => right.length - left.length);
  const pattern = new RegExp(`(^|[^\\w])@(?:${names.join('|')})(?=$|[^\\w])[,;:]*`, 'gi');
  return content.replace(pattern, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

export function buildMentionRoster(candidates: readonly MentionCandidate[]) {
  const mentions = dedupeMentionCandidates(candidates);
  const byOrchestratorName = new Map(mentions.filter((candidate) => candidate.type === 'orchestrator').map((candidate) => [candidate.name, candidate]));
  const orchestrators = CANONICAL_ORCHESTRATOR_NAMES.map((name) => byOrchestratorName.get(name)).filter((candidate): candidate is MentionCandidate => Boolean(candidate));
  if (orchestrators.length !== CANONICAL_ORCHESTRATOR_NAMES.length) throw new ChorusError('conflict', 'canonical orchestrator roster is incomplete');
  const everyone = mentions.find((candidate) => candidate.type === 'everyone');
  if (!everyone) throw new ChorusError('conflict', 'everyone mention is unavailable');
  const members = mentions.filter((candidate) => candidate.type === 'user').sort((left, right) => left.name.localeCompare(right.name));
  return { orchestrators, everyone, members };
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
    listChannels: (c: Context) => run(c, async (resolved) => {
      const access = await dependencies.service.generalChannel(resolved);
      const roster = buildMentionRoster(access.mentions);
      const project = ({ participantKey, type, key: mentionKey, name, role, mentionCount }: MentionCandidate) => ({ participantKey, type, key: mentionKey, name, role, mentionCount });
      return { channels: [channelSummary(access.channel)], mentionRoster: { orchestrators: roster.orchestrators.map(project), everyone: project(roster.everyone), members: roster.members.map(project) } };
    }),
    transcribe: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, transcriptionBody);
      const access = await dependencies.service.generalChannel(resolved);
      const memberNames = access.mentions.filter((mention) => mention.type === 'user').map((mention) => `@${mention.name}`);
      const names = ['@everyone', ...CANONICAL_ORCHESTRATOR_NAMES.map((name) => `@${name}`), ...memberNames].join(', ').slice(0, 1_000);
      return dependencies.transcribe(resolved.organizationKey, body.audioBase64, `Valid mention names are: ${names}.`, c.req.raw.signal);
    }),
    speak: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, speechBody);
      return dependencies.speak(resolved.organizationKey, body.text, c.req.raw.signal);
    }),
    listMessages: (c: Context) => run(c, async (resolved) => ({ messages: await dependencies.service.listMessages(resolved, key.parse(c.req.param('channelKey')), parseQuery(c, chorusMessageListQuerySchema).limit) })),
    typing: (c: Context) => run(c, async (resolved) => {
      const channelKey = key.parse(c.req.param('channelKey'));
      const body = await parseJson(c, typingBody);
      const access = await dependencies.service.requireChannel(resolved, channelKey);
      await dependencies.publishTyping?.({ organizationKey: resolved.organizationKey, channelKey, participantKey: access.humanParticipant.key, type: 'user', name: resolved.name?.trim() || 'Member', active: body.active, expiresAt: body.active ? Date.now() + 5_000 : Date.now() });
      return { ok: true };
    }),
    typingStream: async (c: Context) => {
      const resolved = await actor(c);
      if (resolved instanceof Response) return resolved;
      const channelKey = key.parse(c.req.param('channelKey'));
      let access;
      try { access = await dependencies.service.requireChannel(resolved, channelKey); }
      catch (error) { if (error instanceof ChorusError) return c.json({ error: error.message }, statusFor(error)); throw error; }
      return streamSSE(c, async (stream) => {
        let eventId = 0;
        const unsubscribe = dependencies.subscribeTyping?.((event) => {
          if (event.organizationKey !== resolved.organizationKey || event.channelKey !== channelKey || event.participantKey === access.humanParticipant.key) return;
          eventId += 1;
          void stream.writeSSE({ event: 'typing', data: JSON.stringify(event), id: String(eventId) }).catch(() => {});
        }) ?? (() => {});
        const heartbeat = setInterval(() => { void stream.write(': heartbeat\n\n').catch(() => {}); }, 25_000);
        const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
        try { await closed; }
        finally { clearInterval(heartbeat); unsubscribe(); }
      });
    },
    deleteMessage: (c: Context) => run(c, async (resolved) => { await dependencies.service.deleteMessage(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('messageKey'))); return { deleted: true }; }),
    editMessage: (c: Context) => run(c, async (resolved) => {
      const body = await parseJson(c, editMessageBody);
      const message = await dependencies.service.editMessage(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('messageKey')), body.content);
      return { message: storedMessage(message) };
    }),
    postMessage: async (c: Context) => {
      const resolved = await actor(c);
      if (resolved instanceof Response) return resolved;
      const channelKey = key.parse(c.req.param('channelKey'));
      const body = await parseJson(c, messageBody);
      if (activeChannels.has(channelKey)) return c.json({ error: 'a message is already being processed for this channel' }, 409);
      activeChannels.add(channelKey);
      let streamStarted = false;
      try {
        const { access, message, orchestrators } = await dependencies.service.persistUserMessage(resolved, channelKey, body.content, body.threadKey, body.replyToMessageKey);
        const promptMessage = orchestratorPromptMessage(body.content, orchestrators);
        let context = '';
        try {
          context = scopeContext(await dependencies.listScopes(resolved));
        } catch {
          console.error('chorus scope context unavailable', { organizationKey: resolved.organizationKey, channelKey });
        }
        const response = streamSSE(c, async (sse) => {
          streamStarted = true;
          const turnMessageKeys = [message.key];
          const activeTyping = new Map<string, ChorusTypingEvent>();
          const stopTyping = async (orchestratorKey: string) => {
            const current = activeTyping.get(orchestratorKey);
            if (!current) return;
            activeTyping.delete(orchestratorKey);
            await dependencies.publishTyping?.({ ...current, active: false, expiresAt: Date.now() });
          };
          try {
            await sse.writeSSE({ event: 'start', data: JSON.stringify({ channelKey, userMessage: storedMessage(message) }) });
            if (!orchestrators.length && mentionsCanonicalOrchestrator(body.content)) {
              await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'mentioned orchestrator is unavailable' }) });
              return;
            }
            for (const orchestrator of orchestrators) {
              const typingEvent: ChorusTypingEvent = { organizationKey: resolved.organizationKey, channelKey, participantKey: orchestrator.participantKey, type: 'orchestrator', name: orchestrator.name, active: true, expiresAt: Date.now() + 120_000 };
              activeTyping.set(orchestrator.key, typingEvent);
              await dependencies.publishTyping?.(typingEvent);
              await sse.writeSSE({ event: 'assistant-start', data: JSON.stringify({ orchestrator: { participantKey: orchestrator.participantKey, key: orchestrator.key, name: orchestrator.name } }) });
              let storedContent = '';
              try {
                const provider = dependencies.stream([orchestrator.skill, responseIdentity(orchestrator.name, orchestrator.role), context, CHORUS_RESPONSE_INSTRUCTION].filter(Boolean).join('\n\n'), { message: promptMessage }, {
                  organizationKey: resolved.organizationKey,
                    retrievalContext: { organizationKey: resolved.organizationKey, membershipKey: resolved.membershipKey, exclude: { messages: [...turnMessageKeys] } },
                  signal: c.req.raw.signal,
                });
                for await (const chunk of provider) {
                  if (chunk.type === 'text-delta' && chunk.text) {
                    const accepted = boundedAssistantDelta(storedContent, chunk.text);
                    if (!accepted) continue;
                    storedContent += accepted;
                    await sse.writeSSE({ event: 'token', data: JSON.stringify({ orchestratorKey: orchestrator.key, text: accepted }) });
                  }
                }
                if (!storedContent.trim()) throw new Error('orchestrator returned no valid content');
              } catch (error) {
                if (requestWasAborted(c.req.raw.signal)) {
                  try {
                    await sse.writeSSE({ event: 'assistant-error', data: JSON.stringify({ orchestratorKey: orchestrator.key }) });
                    await sse.writeSSE({ event: 'complete', data: JSON.stringify({}) });
                  } catch {}
                  return;
                }
                console.error('chorus orchestrator stream failed', { channelKey, orchestratorKey: orchestrator.key, error });
                const fallback = storedContent.trim() ? CHORUS_PARTIAL_FALLBACK : CHORUS_PROVIDER_FALLBACK;
                const accepted = boundedAssistantDelta(storedContent, fallback);
                if (accepted) {
                  storedContent += accepted;
                  await sse.writeSSE({ event: 'token', data: JSON.stringify({ orchestratorKey: orchestrator.key, text: accepted }) });
                }
              }
              if (!storedContent.trim()) {
                await sse.writeSSE({ event: 'assistant-error', data: JSON.stringify({ orchestratorKey: orchestrator.key }) });
                await stopTyping(orchestrator.key);
                continue;
              }
              let assistantMessage: Awaited<ReturnType<ChorusService['persistOrchestratorMessage']>>;
              try {
                assistantMessage = await dependencies.service.persistOrchestratorMessage(access, orchestrator, storedContent, message.threadKey, body.replyToMessageKey, message.key);
              } catch (persistenceError) {
                console.error('chorus orchestrator message persistence failed', { channelKey, orchestratorKey: orchestrator.key, error: persistenceError });
                await sse.writeSSE({ event: 'assistant-error', data: JSON.stringify({ orchestratorKey: orchestrator.key }) });
                await stopTyping(orchestrator.key);
                continue;
              }
              turnMessageKeys.push(assistantMessage.key);
              await sse.writeSSE({ event: 'done', data: JSON.stringify({ orchestratorKey: orchestrator.key, message: storedMessage(assistantMessage) }) });
              await stopTyping(orchestrator.key);
            }
            await sse.writeSSE({ event: 'complete', data: JSON.stringify({}) });
          } catch (error) {
            console.error('chorus stream failed', { channelKey, error });
            await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'orchestrator stream failed' }) });
          } finally {
            await Promise.all([...activeTyping.keys()].map(stopTyping));
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
    frequentReactions: (c: Context) => run(c, async (resolved) => ({ reactions: await dependencies.service.frequentReactions(resolved, 10) })),
    readReplies: (c: Context) => run(c, async (resolved) => dependencies.service.readReplies(resolved, key.parse(c.req.param('channelKey')), key.parse(c.req.param('messageKey')))),
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
