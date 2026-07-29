import { newId } from '@/lib/ids';
import { messageSchema, type Message } from '@/lib/db/messages.node';
import { threadSchema } from '@/lib/db/threads.node';
import { pollSchema } from '@/lib/db/polls.node';
import { pollOptionSchema } from '@/lib/db/poll-options.node';
import { pollVoteSchema } from '@/lib/db/poll-votes.node';
import { arangoCommunicationRepository, CommunicationConflictError, type CommunicationRepository, type GeneralChannelAccess, type MentionCandidate } from './repository';
import { messageMentionSchema } from '@/lib/db/message-mentions.node';

export type ChorusErrorCode = 'forbidden' | 'not_found' | 'conflict';
export class ChorusError extends Error {
  constructor(readonly code: ChorusErrorCode, message: string) { super(message); this.name = 'ChorusError'; }
}

export interface ChorusActor { organizationKey: string; membershipKey: string }
const isoNow = () => new Date().toISOString();

export class ChorusService {
  constructor(private readonly repository: CommunicationRepository = arangoCommunicationRepository, private readonly now = isoNow) {}

  async generalChannel(actor: ChorusActor) {
    const access = await this.repository.ensureGeneralChannel(actor.organizationKey, actor.membershipKey);
    if (!access) throw new ChorusError('forbidden', 'organization access denied');
    return await this.repository.getGeneralChannelAccess(actor.organizationKey, actor.membershipKey, access.channel.key) ?? access;
  }

  async requireChannel(actor: ChorusActor, channelKey: string): Promise<GeneralChannelAccess> {
    const access = await this.repository.getGeneralChannelAccess(actor.organizationKey, actor.membershipKey, channelKey);
    if (!access) throw new ChorusError('forbidden', 'channel access denied');
    return access;
  }

  async listMessages(actor: ChorusActor, channelKey: string, limit = 100) {
    const access = await this.requireChannel(actor, channelKey);
    return this.repository.listMessages(channelKey, access.humanParticipant.key, limit);
  }

  async clearChannel(actor: ChorusActor, channelKey: string) {
    await this.requireChannel(actor, channelKey);
    return this.repository.clearChannel(channelKey, this.now());
  }

  async deleteMessage(actor: ChorusActor, channelKey: string, messageKey: string) {
    await this.requireChannel(actor, channelKey);
    if (!await this.repository.deleteMessage(channelKey, messageKey, actor.membershipKey, this.now())) throw new ChorusError('forbidden', 'message deletion denied');
  }

  async persistUserMessage(actor: ChorusActor, channelKey: string, content: string, threadKey?: string, replyToMessageKey?: string) {
    const access = await this.requireChannel(actor, channelKey);
    await this.validateReply(channelKey, threadKey, replyToMessageKey);
    const message = await this.repository.insertMessage(this.message(access, access.humanParticipant.key, content, threadKey, replyToMessageKey));
    const mentions = this.mentions(access, message.key, content);
    await this.repository.insertMentions(mentions.map(({ candidate, mention }) => mention));
    await this.repository.recordUserMentions(access.viewerUserKey, [...new Set([...( /(^|[^\w])@everyone\b/i.test(content) ? ['everyone'] : []), ...mentions.map(({ candidate }) => candidate.key)])], this.now());
    return { access, message, orchestrators: mentions.filter(({ candidate }) => candidate.type === 'orchestrator').map(({ candidate }) => candidate) };
  }

  async persistOrchestratorMessage(access: GeneralChannelAccess, orchestrator: MentionCandidate, content: string, threadKey?: string, replyToMessageKey?: string) {
    return this.repository.insertMessage(this.message(access, orchestrator.participantKey, content, threadKey, replyToMessageKey));
  }

  async history(access: GeneralChannelAccess, threadKey?: string, excludeMessageKey?: string, limit = 40) {
    return this.repository.listHistory(access.channel.key, threadKey, excludeMessageKey, limit);
  }

  async react(actor: ChorusActor, channelKey: string, messageKey: string, reaction: string, mode: 'add' | 'remove' | 'toggle') {
    const access = await this.requireChannel(actor, channelKey);
    await this.requireMessage(channelKey, messageKey);
    const result = await this.repository.mutateReaction({ mode, channelKey, messageKey, participantKey: access.humanParticipant.key, reaction, now: this.now() });
    if (!result) throw new ChorusError('not_found', 'message not found');
    if (result.active && result.changed) await this.repository.recordUserReaction(access.viewerUserKey, reaction, this.now());
    return { active: result.active };
  }

  async frequentReactions(actor: ChorusActor, limit = 10) {
    const access = await this.generalChannel(actor);
    return this.repository.listUserReactions(access.viewerUserKey, limit);
  }

  async listThreads(actor: ChorusActor, channelKey: string) {
    await this.requireChannel(actor, channelKey);
    return this.repository.listThreads(channelKey);
  }

  async createThread(actor: ChorusActor, channelKey: string, rootMessageKey: string, title: string) {
    const access = await this.requireChannel(actor, channelKey);
    const root = await this.requireMessage(channelKey, rootMessageKey);
    if (root.threadKey) throw new ChorusError('conflict', 'thread replies cannot be thread roots');
    const now = this.now();
    try {
      return await this.repository.createThread(threadSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey, title, rootMessageKey, status: 'open', createdAt: now, updatedAt: now }));
    } catch (error) {
      if (error instanceof CommunicationConflictError) throw new ChorusError('conflict', error.message);
      throw error;
    }
  }

  async readThread(actor: ChorusActor, channelKey: string, threadKey: string) {
    const access = await this.requireChannel(actor, channelKey);
    const thread = await this.repository.getThread(threadKey);
    if (!thread || thread.channelKey !== channelKey) throw new ChorusError('not_found', 'thread not found');
    const messages = await this.repository.listThreadMessages(channelKey, thread.key, thread.rootMessageKey, access.humanParticipant.key, 200);
    return { thread, messages };
  }

  async replyThread(actor: ChorusActor, channelKey: string, threadKey: string, content: string, replyToMessageKey?: string) {
    const thread = await this.repository.getThread(threadKey);
    if (!thread || thread.channelKey !== channelKey) throw new ChorusError('not_found', 'thread not found');
    if (thread.status !== 'open') throw new ChorusError('conflict', 'thread is not open');
    return (await this.persistUserMessage(actor, channelKey, content, threadKey, replyToMessageKey)).message;
  }

  async resolveThread(actor: ChorusActor, channelKey: string, threadKey: string) {
    await this.requireChannel(actor, channelKey);
    const thread = await this.repository.resolveThread(threadKey, channelKey, this.now());
    if (!thread) throw new ChorusError('not_found', 'thread not found');
    return thread;
  }

  async archiveThread(actor: ChorusActor, channelKey: string, threadKey: string) {
    await this.requireChannel(actor, channelKey);
    const thread = await this.repository.archiveThread(threadKey, channelKey, this.now());
    if (!thread) throw new ChorusError('not_found', 'thread not found');
    return thread;
  }

  async createPoll(actor: ChorusActor, channelKey: string, messageKey: string, question: string, optionTexts: string[], allowMultiple: boolean) {
    const access = await this.requireChannel(actor, channelKey);
    await this.requireMessage(channelKey, messageKey);
    const now = this.now();
    const poll = pollSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey, messageKey, creatorParticipantKey: access.humanParticipant.key, question, allowMultiple, status: 'open', createdAt: now, updatedAt: now });
    const options = optionTexts.map((text, position) => pollOptionSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey, pollKey: poll.key, text, position, createdAt: now, updatedAt: now }));
    try {
      return await this.repository.createPoll(poll, options);
    } catch (error) {
      if (error instanceof CommunicationConflictError) throw new ChorusError('conflict', error.message);
      throw error;
    }
  }

  async readPoll(actor: ChorusActor, channelKey: string, pollKey: string) {
    const access = await this.requireChannel(actor, channelKey);
    const poll = await this.repository.getPollProjection(pollKey, channelKey, access.humanParticipant.key);
    if (!poll) throw new ChorusError('not_found', 'poll not found');
    return poll;
  }

  async votePoll(actor: ChorusActor, channelKey: string, pollKey: string, optionKey: string) {
    const access = await this.requireChannel(actor, channelKey);
    const poll = await this.repository.getPollProjection(pollKey, channelKey, access.humanParticipant.key);
    if (!poll) throw new ChorusError('not_found', 'poll not found');
    if (poll.status !== 'open') throw new ChorusError('conflict', 'poll is closed');
    if (!poll.options.some((option) => option.key === optionKey)) throw new ChorusError('not_found', 'poll option not found');
    const now = this.now();
    const vote = pollVoteSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey, pollKey, optionKey, participantKey: access.humanParticipant.key, createdAt: now, updatedAt: now });
    const result = await this.repository.votePoll({ vote, allowMultiple: poll.allowMultiple });
    if (result.outcome === 'not_found') throw new ChorusError('not_found', 'poll or option not found');
    if (result.outcome === 'conflict') throw new ChorusError('conflict', 'poll is closed');
    return result.poll;
  }

  async closePoll(actor: ChorusActor, channelKey: string, pollKey: string) {
    const access = await this.requireChannel(actor, channelKey);
    const poll = await this.repository.closePoll(pollKey, channelKey, access.humanParticipant.key, this.now());
    if (!poll) throw new ChorusError('forbidden', 'only the poll creator may close this poll');
    return poll;
  }

  private mentions(access: GeneralChannelAccess, messageKey: string, content: string) {
    const selected = new Map<string, MentionCandidate>();
    const hasEveryone = /(^|[^\w])@everyone\b/i.test(content);
    for (const candidate of access.mentions) {
      if (candidate.type === 'everyone') continue;
      const pattern = new RegExp(`(^|[^\\w])@${candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i');
      if ((hasEveryone && candidate.type === 'user') || pattern.test(content)) selected.set(candidate.participantKey, candidate);
    }
    const now = this.now();
    return [...selected.values()].map((candidate) => ({ candidate, mention: messageMentionSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey: access.channel.key, messageKey, participantKey: candidate.participantKey, createdAt: now, updatedAt: now }) }));
  }

  private message(access: GeneralChannelAccess, authorParticipantKey: string, content: string, threadKey?: string, replyToMessageKey?: string): Message {
    const now = this.now();
    return messageSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey: access.channel.key, authorParticipantKey, content, threadKey, replyToMessageKey, createdAt: now, updatedAt: now });
  }

  private async requireMessage(channelKey: string, messageKey: string) {
    const message = await this.repository.getMessage(messageKey);
    if (!message || message.channelKey !== channelKey) throw new ChorusError('not_found', 'message not found');
    return message;
  }

  private async validateReply(channelKey: string, threadKey?: string, replyToMessageKey?: string) {
    if (threadKey) {
      const thread = await this.repository.getThread(threadKey);
      if (!thread || thread.channelKey !== channelKey) throw new ChorusError('not_found', 'thread not found');
    }
    if (replyToMessageKey) {
      const reply = await this.requireMessage(channelKey, replyToMessageKey);
      if (reply.threadKey !== threadKey) throw new ChorusError('conflict', 'reply target must be in the same thread');
    }
  }
}
