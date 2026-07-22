import type { Channel, ChannelParticipant, Message, MessageMention, MessageReaction, Thread } from './schema';

export interface ChorusLookup {
  hasScope(scopeKey: string): Promise<boolean>;
  getChannel(channelKey: string): Promise<Channel | null>;
  getParticipant(participantKey: string): Promise<ChannelParticipant | null>;
  getMessage(messageKey: string): Promise<Message | null>;
  getThread(threadKey: string): Promise<Thread | null>;
  hasActiveScopeMember(scopeKey: string, userOrganizationKey: string): Promise<boolean>;
  hasOrchestratorScopeAccess(scopeKey: string, orchestratorKey: string): Promise<boolean>;
}

export class ChorusReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChorusReferenceError';
  }
}

function matchesChannel(value: { scopeKey: string; channelKey: string }, channel: Channel) {
  return value.scopeKey === channel.scopeKey && value.channelKey === channel.key;
}

export async function validateChannel(input: Channel, lookup: ChorusLookup) {
  if (!await lookup.hasScope(input.scopeKey)) throw new ChorusReferenceError('Channel scope does not exist');
}

export async function validateChannelParticipant(input: ChannelParticipant, lookup: ChorusLookup) {
  const channel = await lookup.getChannel(input.channelKey);
  if (!channel || !matchesChannel(input, channel)) throw new ChorusReferenceError('Participant channel and scope must match');
  if (input.userOrganizationKey && !await lookup.hasActiveScopeMember(input.scopeKey, input.userOrganizationKey)) throw new ChorusReferenceError('Human participant requires active scope membership');
  if (input.orchestratorKey && !await lookup.hasOrchestratorScopeAccess(input.scopeKey, input.orchestratorKey)) throw new ChorusReferenceError('Orchestrator does not have scope access');
}

export async function validateThread(input: Thread, lookup: ChorusLookup) {
  const [channel, root] = await Promise.all([lookup.getChannel(input.channelKey), lookup.getMessage(input.rootMessageKey)]);
  if (!channel || !matchesChannel(input, channel) || !root || root.scopeKey !== input.scopeKey || root.channelKey !== input.channelKey) throw new ChorusReferenceError('Thread root message must belong to its channel and scope');
}

export async function validateMessage(input: Message, lookup: ChorusLookup) {
  const [channel, author, thread, reply] = await Promise.all([lookup.getChannel(input.channelKey), lookup.getParticipant(input.authorParticipantKey), input.threadKey ? lookup.getThread(input.threadKey) : null, input.replyToMessageKey ? lookup.getMessage(input.replyToMessageKey) : null]);
  if (!channel || !matchesChannel(input, channel)) throw new ChorusReferenceError('Message channel and scope must match');
  if (!author || author.scopeKey !== input.scopeKey || author.channelKey !== input.channelKey) throw new ChorusReferenceError('Message author must participate in its channel');
  if (thread && (!matchesChannel(thread, channel) || thread.scopeKey !== input.scopeKey)) throw new ChorusReferenceError('Message thread must belong to its channel and scope');
  if (input.threadKey && !thread) throw new ChorusReferenceError('Message thread does not exist');
  if (reply && (reply.scopeKey !== input.scopeKey || reply.channelKey !== input.channelKey || reply.threadKey !== input.threadKey)) throw new ChorusReferenceError('Message reply must remain in the same channel and thread');
  if (input.replyToMessageKey && !reply) throw new ChorusReferenceError('Message reply target does not exist');
}

async function validateMessageParticipant(input: MessageMention | MessageReaction, lookup: ChorusLookup) {
  const [message, participant] = await Promise.all([lookup.getMessage(input.messageKey), lookup.getParticipant(input.participantKey)]);
  if (!message || message.scopeKey !== input.scopeKey || message.channelKey !== input.channelKey) throw new ChorusReferenceError('Referenced message must match scope and channel');
  if (!participant || participant.scopeKey !== input.scopeKey || participant.channelKey !== input.channelKey) throw new ChorusReferenceError('Referenced participant must match scope and channel');
}

export const validateMessageMention = validateMessageParticipant;
export const validateMessageReaction = validateMessageParticipant;
