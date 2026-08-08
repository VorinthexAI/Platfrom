import { newId } from '@/lib/ids';
import { createHash } from 'node:crypto';
import { messageSchema, type Message } from '@/lib/db/messages.node';
import { pollSchema } from '@/lib/db/polls.node';
import { pollOptionSchema } from '@/lib/db/poll-options.node';
import { pollVoteSchema } from '@/lib/db/poll-votes.node';
import { arangoCommunicationRepository, CommunicationConflictError, type CommunicationRepository, type GeneralChannelAccess, type MentionCandidate } from './repository';
import { messageMentionSchema } from '@/lib/db/message-mentions.node';

export type ChorusErrorCode = 'forbidden' | 'not_found' | 'conflict';
export class ChorusError extends Error {
  constructor(readonly code: ChorusErrorCode, message: string) { super(message); this.name = 'ChorusError'; }
}

export interface ChorusActor { organizationKey: string; membershipKey: string; name?: string }
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

  async deleteMessage(actor: ChorusActor, channelKey: string, messageKey: string) {
    await this.requireChannel(actor, channelKey);
    await this.requireMessage(channelKey, messageKey);
    if (!await this.repository.deleteMessage(channelKey, messageKey, actor.membershipKey, this.now())) {
      throw new ChorusError('forbidden', 'message deletion denied');
    }
  }

  async editMessage(actor: ChorusActor, channelKey: string, messageKey: string, content: string) {
    await this.requireChannel(actor, channelKey);
    await this.requireMessage(channelKey, messageKey);
    const edited = await this.repository.editMessage(channelKey, messageKey, actor.membershipKey, content, this.now());
    if (!edited) throw new ChorusError('forbidden', 'only the message author may edit this message');
    return edited;
  }

  async persistUserMessage(actor: ChorusActor, channelKey: string, content: string, threadKey?: string, replyToMessageKey?: string) {
    const access = await this.requireChannel(actor, channelKey);
    const resolvedThreadKey = await this.resolveReplyContext(channelKey, threadKey, replyToMessageKey);
    const message = await this.repository.insertMessage(this.message(access, access.humanParticipant.key, content, resolvedThreadKey, replyToMessageKey));
    const mentions = this.mentions(access, message.key, content);
    await this.repository.insertMentions(mentions.map(({ candidate, mention }) => mention));
    await this.repository.recordUserMentions(access.viewerUserKey, [...new Set([...( /(^|[^\w])@everyone\b/i.test(content) ? ['everyone'] : []), ...mentions.map(({ candidate }) => candidate.key)])], this.now());
    return { access, message, orchestrators: mentions.filter(({ candidate }) => candidate.type === 'orchestrator').map(({ candidate }) => candidate) };
  }

  async resolveOrchestrators(actor: ChorusActor, channelKey: string, content: string) {
    const access = await this.requireChannel(actor, channelKey);
    return this.selectedCandidates(access, content).filter((candidate) => candidate.type === 'orchestrator');
  }

  async persistOrchestratorMessage(access: GeneralChannelAccess, orchestrator: MentionCandidate, content: string, threadKey?: string, replyToMessageKey?: string, sourceMessageKey?: string) {
    if (sourceMessageKey) await this.requireMessage(access.channel.key, sourceMessageKey);
    const responseKey = sourceMessageKey ? `c${createHash('sha256').update(sourceMessageKey).update('\0').update(orchestrator.key).digest('hex').slice(0, 24)}` : undefined;
    const message = sourceMessageKey
      ? await this.repository.upsertMessage(this.message(access, orchestrator.participantKey, content, threadKey, replyToMessageKey, responseKey))
      : await this.repository.insertMessage(this.message(access, orchestrator.participantKey, content, threadKey, replyToMessageKey));
    return message;
  }

  async history(access: GeneralChannelAccess, threadKey?: string, excludeMessageKey?: string, limit = 40) {
    return this.repository.listHistory(access.channel.key, threadKey, excludeMessageKey, limit);
  }

  async react(actor: ChorusActor, channelKey: string, messageKey: string, reaction: string, mode: 'add' | 'remove' | 'toggle') {
    const access = await this.requireChannel(actor, channelKey);
    await this.requireMessage(channelKey, messageKey);
    const result = await this.repository.mutateReaction({ mode, channelKey, messageKey, participantKey: access.humanParticipant.key, reaction, now: this.now() });
    if (!result) throw new ChorusError('not_found', 'message not found');
    if (result.active && result.changed) {
      try {
        await this.repository.recordUserReaction(access.viewerUserKey, reaction, this.now());
      } catch (error) {
        console.error('chorus reaction usage recording failed', { userKey: access.viewerUserKey, reaction, error });
      }
    }
    return { active: result.active };
  }

  async frequentReactions(actor: ChorusActor, limit = 10) {
    const access = await this.generalChannel(actor);
    return this.repository.listUserReactions(access.viewerUserKey, limit);
  }

  async readReplies(actor: ChorusActor, channelKey: string, parentMessageKey: string) {
    const access = await this.requireChannel(actor, channelKey);
    const parent = await this.requireMessage(channelKey, parentMessageKey);
    const legacyReplyGroup = parent.threadKey ? await this.repository.getThread(parent.threadKey) : await this.repository.getThreadByRootMessage(parent.key);
    const messages = legacyReplyGroup
      ? await this.repository.listThreadMessages(channelKey, legacyReplyGroup.key, legacyReplyGroup.rootMessageKey, access.humanParticipant.key, 200)
      : await this.repository.listMessageReplies(channelKey, parentMessageKey, access.humanParticipant.key, 200);
    return { parentMessageKey, messages };
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
    const selected = this.selectedCandidates(access, content);
    const now = this.now();
    return selected.map((candidate) => ({ candidate, mention: messageMentionSchema.parse({ key: newId(), scopeKey: access.channel.scopeKey, channelKey: access.channel.key, messageKey, participantKey: candidate.participantKey, createdAt: now, updatedAt: now }) }));
  }

  private selectedCandidates(access: GeneralChannelAccess, content: string) {
    const selected = new Map<string, MentionCandidate>();
    const hasEveryone = /(^|[^\w])@everyone\b/i.test(content);
    for (const candidate of access.mentions) {
      if (candidate.type === 'everyone') continue;
      const pattern = new RegExp(`(^|[^\\w])@${candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w])`, 'i');
      if ((hasEveryone && candidate.type === 'user') || pattern.test(content)) selected.set(candidate.participantKey, candidate);
    }
    return [...selected.values()];
  }

  private message(access: GeneralChannelAccess, authorParticipantKey: string, content: string, threadKey?: string, replyToMessageKey?: string, key = newId()): Message {
    const now = this.now();
    return messageSchema.parse({ key, scopeKey: access.channel.scopeKey, channelKey: access.channel.key, authorParticipantKey, content, threadKey, replyToMessageKey, createdAt: now, updatedAt: now });
  }

  private async requireMessage(channelKey: string, messageKey: string) {
    const message = await this.repository.getMessage(messageKey);
    if (!message || message.channelKey !== channelKey) throw new ChorusError('not_found', 'message not found');
    return message;
  }

  private async resolveReplyContext(channelKey: string, requestedThreadKey?: string, replyToMessageKey?: string) {
    let threadKey = requestedThreadKey;
    if (replyToMessageKey) {
      const parent = await this.requireMessage(channelKey, replyToMessageKey);
      const legacyReplyGroup = parent.threadKey ? await this.repository.getThread(parent.threadKey) : await this.repository.getThreadByRootMessage(parent.key);
      const derivedThreadKey = parent.threadKey ?? legacyReplyGroup?.key;
      if (threadKey && threadKey !== derivedThreadKey) throw new ChorusError('conflict', 'reply target must remain in the same reply group');
      threadKey = derivedThreadKey;
    }
    if (threadKey) {
      const legacyReplyGroup = await this.repository.getThread(threadKey);
      if (!legacyReplyGroup || legacyReplyGroup.channelKey !== channelKey) throw new ChorusError('not_found', 'reply group not found');
      if (legacyReplyGroup.status !== 'open') throw new ChorusError('conflict', 'replies are closed');
    }
    return threadKey;
  }

}
