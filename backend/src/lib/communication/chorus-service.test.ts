import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { channelSchema, type Channel } from '@/lib/db/channels.node';
import { channelParticipantSchema, type ChannelParticipant } from '@/lib/db/channel-participants.node';
import type { Message } from '@/lib/db/messages.node';
import type { Thread } from '@/lib/db/threads.node';
import type { Poll } from '@/lib/db/polls.node';
import type { PollOption } from '@/lib/db/poll-options.node';
import type { PollVote } from '@/lib/db/poll-votes.node';
import { ChorusError, ChorusService } from './chorus-service';
import type { CommunicationRepository, DirectChannelAccess, DirectOrchestratorCandidate, MessageProjection, PollProjection } from './repository';

const now = '2026-07-24T12:00:00.000Z';
const organizationKey = 'root-org';
const membershipKey = newId();
const orchestratorKey = newId();
const scopeKey = newId();
const actor = { organizationKey, membershipKey };

class MemoryRepository implements CommunicationRepository {
  allowed = true;
  ensureCalls = 0;
  channels: Channel[] = [];
  participants: ChannelParticipant[] = [];
  messages: Message[] = [];
  threads: Thread[] = [];
  polls: Poll[] = [];
  options: PollOption[] = [];
  votes: PollVote[] = [];
  reactions = new Map<string, boolean>();

  candidate(): DirectOrchestratorCandidate {
    return { orchestrator: { key: orchestratorKey, name: 'Atlas', role: 'CEO', skill: 'Lead.' }, scopeKey, canChat: this.allowed, channel: this.channels[0] ?? null };
  }
  async listDirectCandidates() { return [this.candidate()]; }
  async ensureDirectChannel() {
    this.ensureCalls++;
    if (!this.allowed) return null;
    if (!this.channels[0]) {
      const channel = channelSchema.parse({ key: newId(), scopeKey, kind: 'direct', directUserOrganizationKey: membershipKey, directOrchestratorKey: orchestratorKey, name: 'Atlas', position: 0, createdAt: now, updatedAt: now });
      this.channels.push(channel);
      this.participants.push(
        channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, userOrganizationKey: membershipKey, joinedAt: now, createdAt: now, updatedAt: now }),
        channelParticipantSchema.parse({ key: newId(), scopeKey, channelKey: channel.key, orchestratorKey, joinedAt: now, createdAt: now, updatedAt: now }),
      );
    }
    return this.access();
  }
  access(): DirectChannelAccess {
    return { channel: this.channels[0]!, humanParticipant: this.participants[0]!, orchestratorParticipant: this.participants[1]!, orchestrator: this.candidate().orchestrator };
  }
  async getDirectChannelAccess(org: string, member: string, channel: string) {
    return this.allowed && org === organizationKey && member === membershipKey && channel === this.channels[0]?.key ? this.access() : null;
  }
  projection(message: Message): MessageProjection {
    const human = message.authorParticipantKey === this.participants[0]?.key;
    return { key: message.key, channelKey: message.channelKey, threadKey: message.threadKey, replyToMessageKey: message.replyToMessageKey, content: message.content, createdAt: message.createdAt, updatedAt: message.updatedAt, author: { participantKey: message.authorParticipantKey, type: human ? 'user' : 'orchestrator', key: human ? membershipKey : orchestratorKey, name: human ? 'Founder' : 'Atlas' }, reactions: [], thread: null, poll: null };
  }
  async listMessages(channelKey: string, _viewer: string, limit: number) { return this.messages.filter((item) => item.channelKey === channelKey && !item.threadKey && !item.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit).map((item) => this.projection(item)); }
  async listThreadMessages(channelKey: string, threadKey: string, rootMessageKey: string, _viewer: string, limit: number) { return this.messages.filter((item) => item.channelKey === channelKey && !item.deletedAt && (item.key === rootMessageKey || item.threadKey === threadKey)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit).map((item) => this.projection(item)); }
  async listHistory(channelKey: string, threadKey: string | undefined, excludeMessageKey: string | undefined, limit: number) { const thread = threadKey ? this.threads.find((item) => item.key === threadKey) : null; return this.messages.filter((item) => item.channelKey === channelKey && !item.deletedAt && item.key !== excludeMessageKey && (threadKey ? item.threadKey === threadKey || item.key === thread?.rootMessageKey : !item.threadKey)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit).map((item) => ({ role: item.authorParticipantKey === this.participants[0]?.key ? 'user' as const : 'assistant' as const, content: item.content })); }
  async getMessage(messageKey: string) { return this.messages.find((item) => item.key === messageKey && !item.deletedAt) ?? null; }
  async insertMessage(message: Message) { this.messages.push(message); return message; }
  async mutateReaction(input: { mode: 'add' | 'remove' | 'toggle'; messageKey: string; participantKey: string; reaction: string }) {
    const id = `${input.messageKey}:${input.participantKey}:${input.reaction}`;
    const active = input.mode === 'add' ? true : input.mode === 'remove' ? false : !this.reactions.has(id);
    if (active) this.reactions.set(id, true); else this.reactions.delete(id);
    return { active };
  }
  async createThread(thread: Thread) {
    if (this.threads.some((item) => item.rootMessageKey === thread.rootMessageKey)) throw new ChorusError('conflict', 'thread already exists');
    this.threads.push(thread); return thread;
  }
  async getThread(threadKey: string) { return this.threads.find((item) => item.key === threadKey) ?? null; }
  async resolveThread(threadKey: string, channelKey: string, updatedAt: string) { const thread = this.threads.find((item) => item.key === threadKey && item.channelKey === channelKey); if (!thread) return null; thread.status = 'resolved'; thread.updatedAt = updatedAt; return thread; }
  async archiveThread(threadKey: string, channelKey: string, updatedAt: string) { const thread = this.threads.find((item) => item.key === threadKey && item.channelKey === channelKey); if (!thread) return null; thread.status = 'archived'; thread.updatedAt = updatedAt; return thread; }
  pollProjection(poll: Poll, viewer: string): PollProjection {
    return { key: poll.key, question: poll.question, allowMultiple: poll.allowMultiple, status: poll.status, closedAt: poll.closedAt, options: this.options.filter((item) => item.pollKey === poll.key).sort((a, b) => a.position - b.position).map((option) => ({ key: option.key, text: option.text, position: option.position, voteCount: this.votes.filter((vote) => vote.optionKey === option.key).length, viewerVoted: this.votes.some((vote) => vote.optionKey === option.key && vote.participantKey === viewer) })) };
  }
  async createPoll(poll: Poll, options: PollOption[]) { this.polls.push(poll); this.options.push(...options); return this.pollProjection(poll, poll.creatorParticipantKey); }
  async getPollProjection(pollKey: string, channelKey: string, viewer: string) { const poll = this.polls.find((item) => item.key === pollKey && item.channelKey === channelKey); return poll ? this.pollProjection(poll, viewer) : null; }
  async votePoll({ vote, allowMultiple }: { vote: PollVote; allowMultiple: boolean }) {
    const poll = this.polls.find((item) => item.key === vote.pollKey && item.channelKey === vote.channelKey);
    if (!poll || !this.options.some((item) => item.key === vote.optionKey && item.pollKey === poll.key)) return { outcome: 'not_found' as const };
    if (poll.status !== 'open') return { outcome: 'conflict' as const };
    const selected = this.votes.some((item) => item.optionKey === vote.optionKey && item.participantKey === vote.participantKey);
    if (allowMultiple && selected) { this.votes = this.votes.filter((item) => item.optionKey !== vote.optionKey || item.participantKey !== vote.participantKey); return { outcome: 'ok' as const, poll: this.pollProjection(poll, vote.participantKey) }; }
    if (!allowMultiple) this.votes = this.votes.filter((item) => item.pollKey !== vote.pollKey || item.participantKey !== vote.participantKey);
    if (!this.votes.some((item) => item.optionKey === vote.optionKey && item.participantKey === vote.participantKey)) this.votes.push(vote);
    return { outcome: 'ok' as const, poll: this.pollProjection(poll, vote.participantKey) };
  }
  async closePoll(pollKey: string, channelKey: string, participantKey: string, closedAt: string) { const poll = this.polls.find((item) => item.key === pollKey && item.channelKey === channelKey && item.creatorParticipantKey === participantKey); if (!poll) return null; poll.status = 'closed'; poll.closedAt = closedAt; poll.updatedAt = closedAt; return this.pollProjection(poll, participantKey); }
}

function fixture() { const repository = new MemoryRepository(); const service = new ChorusService(repository, () => now); return { repository, service }; }

describe('Chorus service', () => {
  test('returns no channel and does not provision without active scope membership', async () => {
    const f = fixture(); f.repository.allowed = false;
    expect(await f.service.listDirectChannels(actor)).toEqual([{ orchestrator: f.repository.candidate().orchestrator, scopeKey, canChat: false, channel: null }]);
    expect(f.repository.ensureCalls).toBe(0);
    await expect(f.service.openDirectChannel(actor, orchestratorKey)).rejects.toMatchObject({ code: 'forbidden' });
  });

  test('provisions one channel with exactly two participants idempotently', async () => {
    const f = fixture();
    await f.service.listDirectChannels(actor); await f.service.openDirectChannel(actor, orchestratorKey);
    expect(f.repository.channels).toHaveLength(1); expect(f.repository.participants).toHaveLength(2);
    expect(f.repository.participants.map((item) => item.userOrganizationKey ? 'human' : 'orchestrator').sort()).toEqual(['human', 'orchestrator']);
  });

  test('persists both sides and returns bounded history in chronological order', async () => {
    const f = fixture(); const access = await f.service.openDirectChannel(actor, orchestratorKey);
    const user = await f.service.persistUserMessage(actor, access.channel.key, 'First');
    await f.service.persistOrchestratorMessage(access, 'Second');
    expect((await f.service.listMessages(actor, access.channel.key)).map((item) => item.content)).toEqual(['First', 'Second']);
    expect(await f.service.history(access)).toEqual([{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Second' }]);
    expect(user.message.authorParticipantKey).toBe(access.humanParticipant.key);
  });

  test('denies cross-channel message identifiers and keeps reactions unique/toggleable', async () => {
    const f = fixture(); const access = await f.service.openDirectChannel(actor, orchestratorKey);
    const message = (await f.service.persistUserMessage(actor, access.channel.key, 'React')).message;
    const foreign = { ...message, key: newId(), channelKey: newId() }; f.repository.messages.push(foreign);
    await expect(f.service.react(actor, access.channel.key, foreign.key, '+1', 'add')).rejects.toMatchObject({ code: 'not_found' });
    expect(await f.service.react(actor, access.channel.key, message.key, '+1', 'add')).toEqual({ active: true });
    expect(await f.service.react(actor, access.channel.key, message.key, '+1', 'add')).toEqual({ active: true });
    expect(f.repository.reactions).toHaveLength(1);
    expect(await f.service.react(actor, access.channel.key, message.key, '+1', 'toggle')).toEqual({ active: false });
  });

  test('enforces thread roots, same-thread replies, and resolve lifecycle', async () => {
    const f = fixture(); const access = await f.service.openDirectChannel(actor, orchestratorKey);
    const root = (await f.service.persistUserMessage(actor, access.channel.key, 'Root')).message;
    const thread = await f.service.createThread(actor, access.channel.key, root.key, 'Decision');
    const reply = await f.service.replyThread(actor, access.channel.key, thread.key, 'Reply');
    await f.service.persistOrchestratorMessage(access, 'Thread answer', thread.key, reply.key);
    expect(reply.threadKey).toBe(thread.key);
    await expect(f.service.createThread(actor, access.channel.key, reply.key)).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.service.readThread(actor, access.channel.key, thread.key)).messages.map((item) => item.content)).toEqual(['Root', 'Reply', 'Thread answer']);
    expect((await f.service.listMessages(actor, access.channel.key)).map((item) => item.content)).toEqual(['Root']);
    expect(await f.service.history(access, thread.key, reply.key)).toEqual([{ role: 'user', content: 'Root' }, { role: 'assistant', content: 'Thread answer' }]);
    expect((await f.service.resolveThread(actor, access.channel.key, thread.key)).status).toBe('resolved');
    await expect(f.service.replyThread(actor, access.channel.key, thread.key, 'late')).rejects.toMatchObject({ code: 'conflict' });
    expect((await f.service.archiveThread(actor, access.channel.key, thread.key)).status).toBe('archived');
  });

  test('hides soft-deleted messages from lists, targets, threads, and history', async () => {
    const f = fixture(); const access = await f.service.openDirectChannel(actor, orchestratorKey);
    const message = (await f.service.persistUserMessage(actor, access.channel.key, 'Removed')).message;
    message.deletedAt = now;
    expect(await f.service.listMessages(actor, access.channel.key)).toEqual([]);
    expect(await f.service.history(access)).toEqual([]);
    await expect(f.service.react(actor, access.channel.key, message.key, '+1', 'add')).rejects.toMatchObject({ code: 'not_found' });
  });

  test('supports single and multi vote semantics and rejects votes after close', async () => {
    const f = fixture(); const access = await f.service.openDirectChannel(actor, orchestratorKey);
    const message = (await f.service.persistUserMessage(actor, access.channel.key, 'Choose')).message;
    const single = await f.service.createPoll(actor, access.channel.key, message.key, 'One?', ['A', 'B'], false);
    await f.service.votePoll(actor, access.channel.key, single.key, single.options[0]!.key);
    const changed = await f.service.votePoll(actor, access.channel.key, single.key, single.options[1]!.key);
    expect(changed.options.map((option: PollProjection['options'][number]) => option.viewerVoted)).toEqual([false, true]);
    const unchanged = await f.service.votePoll(actor, access.channel.key, single.key, single.options[1]!.key);
    expect(unchanged.options.map((option: PollProjection['options'][number]) => option.viewerVoted)).toEqual([false, true]);
    const multi = await f.service.createPoll(actor, access.channel.key, { ...message, key: newId() }.key, 'Many?', ['A', 'B'], true).catch(() => null);
    const secondMessage = (await f.service.persistUserMessage(actor, access.channel.key, 'Choose many')).message;
    const actualMulti = multi ?? await f.service.createPoll(actor, access.channel.key, secondMessage.key, 'Many?', ['A', 'B'], true);
    await f.service.votePoll(actor, access.channel.key, actualMulti.key, actualMulti.options[0]!.key);
    const both = await f.service.votePoll(actor, access.channel.key, actualMulti.key, actualMulti.options[1]!.key);
    expect(both.options.map((option: PollProjection['options'][number]) => option.viewerVoted)).toEqual([true, true]);
    const toggled = await f.service.votePoll(actor, access.channel.key, actualMulti.key, actualMulti.options[0]!.key);
    expect(toggled.options.map((option: PollProjection['options'][number]) => option.viewerVoted)).toEqual([false, true]);
    expect((await f.service.closePoll(actor, access.channel.key, actualMulti.key)).status).toBe('closed');
    await expect(f.service.votePoll(actor, access.channel.key, actualMulti.key, actualMulti.options[0]!.key)).rejects.toMatchObject({ code: 'conflict' });
  });
});
