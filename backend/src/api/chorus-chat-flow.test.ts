import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { channelSchema } from '@/lib/db/channels.node';
import { channelParticipantSchema } from '@/lib/db/channel-participants.node';
import type { Message } from '@/lib/db/messages.node';
import { ChorusService } from '@/lib/communication/chorus-service';
import type { CommunicationRepository, GeneralChannelAccess } from '@/lib/communication/repository';
import { orchestratorChatTool } from '@/lib/ai/tools/orchestrator-chat';
import { createChorusHandlers } from './chorus';

const now = '2026-07-29T12:00:00.000Z';

describe('Chorus orchestrator chat flow', () => {
  test('detects a mention, retrieves authorized filtered context, chats with Nova, streams, and persists the response', async () => {
    const organizationKey = 'root-org';
    const membershipKey = newId();
    const scopeKey = newId();
    const channel = channelSchema.parse({ key: newId(), organizationKey, scopeKey, name: 'general', description: 'Organization-wide conversation', position: 0, createdAt: now, updatedAt: now });
    const human = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, userOrganizationKey: membershipKey, joinedAt: now, createdAt: now, updatedAt: now });
    const atlasParticipant = channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, orchestratorKey: newId(), joinedAt: now, createdAt: now, updatedAt: now });
    const access: GeneralChannelAccess = { channel, humanParticipant: human, viewerUserKey: newId(), mentions: [
      { participantKey: 'everyone', type: 'everyone', key: 'everyone', name: 'everyone', mentionCount: 0 },
      { participantKey: atlasParticipant.key, type: 'orchestrator', key: atlasParticipant.orchestratorKey!, name: 'Atlas', role: 'CEO', skill: 'Lead the organization.', mentionCount: 0 },
    ] };
    const messages: Message[] = [];
    const persistedMentions: unknown[] = [];
    const repository = {
      getGeneralChannelAccess: async () => access,
      insertMessage: async (message: Message) => { messages.push(message); return message; },
      upsertMessage: async (message: Message) => { const existing = messages.find(({ key }) => key === message.key); if (existing) return existing; messages.push(message); return message; },
      insertMentions: async (mentions: unknown[]) => { persistedMentions.push(...mentions); },
      recordUserMentions: async () => {},
      getMessage: async (messageKey: string) => messages.find((message) => message.key === messageKey) ?? null,
      getThread: async () => null,
      listMessages: async () => messages.map((message) => ({
        key: message.key,
        channelKey: message.channelKey,
        threadKey: message.threadKey,
        replyToMessageKey: message.replyToMessageKey,
        content: message.content,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        author: message.authorParticipantKey === human.key
          ? { participantKey: human.key, type: 'user' as const, key: access.viewerUserKey, name: 'Founder' }
          : { participantKey: atlasParticipant.key, type: 'orchestrator' as const, key: atlasParticipant.orchestratorKey!, name: 'Atlas' },
        reactions: [],
        replies: { count: 0 },
        poll: null,
      })),
    } as unknown as CommunicationRepository;
    const retrievalQueries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const novaInputs: unknown[] = [];
    const service = new ChorusService(repository, () => now);
    const handlers = createChorusHandlers({
      service,
      resolveActor: async () => ({ organizationKey, membershipKey }),
      stream: (skill, input, dependencies) => orchestratorChatTool.stream(skill, input, {
        ...dependencies,
        embedRetrievalQuery: async () => [1, 0],
        queryRetrieval: async (query, bindVars) => {
          retrievalQueries.push({ query, bindVars });
          return { all: async () => [{ key: 'prior', fields: { content: 'Authorized launch decision.' }, createdAt: now, score: 0.9 }] };
        },
        stream: async function* (_key, chatInput) { novaInputs.push(chatInput); yield { type: 'text-delta', text: 'Atlas response' }; yield { type: 'done' }; },
      }),
      listScopes: async (actor) => { expect(actor).toEqual({ organizationKey, membershipKey }); return []; },
      transcribe: async () => ({ text: '@Atlas hello' }),
      speak: async () => ({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' }),
    });
    const app = new Hono().post('/founders/organizations/:organizationKey/chorus/channels/:channelKey/messages', handlers.postMessage);

    const response = await app.request(`/founders/organizations/${organizationKey}/chorus/channels/${channel.key}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '@Atlas explain the launch' }) });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('event: assistant-start');
    expect(body).toContain('Atlas response');
    expect(body).toContain('event: complete');
    expect(persistedMentions).toHaveLength(1);
    expect(messages.map(({ content }) => content)).toEqual(['@Atlas explain the launch', 'Atlas response']);
    expect(retrievalQueries).toHaveLength(1);
    expect(retrievalQueries[0]?.bindVars).toMatchObject({ organizationKey, membershipKey, filterOrganizationKey: organizationKey, filterKeys: [], limit: 50 });
    expect(retrievalQueries[0]?.bindVars.access).toBe('channel');
    expect(retrievalQueries[0]?.bindVars.excludeKeys).toEqual([messages[0]!.key]);
    expect(retrievalQueries[0]?.bindVars).not.toHaveProperty('collectionName');
    expect(retrievalQueries[0]?.query).toContain('membership.organizationId == @organizationKey');
    expect(retrievalQueries[0]?.query).toContain('document.channelKey IN authorizedChannelKeys');
    expect(novaInputs[0]).toMatchObject({ systemPrompt: expect.stringContaining('Authorized launch decision.'), messages: [{ role: 'user', content: [{ type: 'text', text: '@Atlas explain the launch' }] }] });
    const canonical = await service.listMessages({ organizationKey, membershipKey }, channel.key, 100);
    expect(canonical.map(({ content }) => content)).toEqual(['@Atlas explain the launch', 'Atlas response']);
    expect(canonical[1]).toMatchObject({ author: { type: 'orchestrator', name: 'Atlas' }, reactions: [] });
    expect(canonical[1]?.replyToMessageKey).toBeUndefined();
  });
});
