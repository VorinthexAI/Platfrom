import type { Channel, ChannelParticipant, Message, MessageMention, MessageReaction, Thread } from './schema';

export interface CommunicationLookup {
  hasScope(scopeKey: string): Promise<boolean>;
  getChannel(channelKey: string): Promise<Channel | null>;
  getParticipant(participantKey: string): Promise<ChannelParticipant | null>;
  getMessage(messageKey: string): Promise<Message | null>;
  getThread(threadKey: string): Promise<Thread | null>;
  hasActiveScopeMember(scopeKey: string, userOrganizationKey: string): Promise<boolean>;
  hasOrchestratorScopeAccess(scopeKey: string, orchestratorKey: string): Promise<boolean>;
}

export class CommunicationReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunicationReferenceError';
  }
}

function matchesChannel(value: { scopeKey: string; channelKey: string }, channel: Channel) {
  return value.scopeKey === channel.scopeKey && value.channelKey === channel.key;
}

export async function validateChannel(input: Channel, lookup: CommunicationLookup) {
  if (!await lookup.hasScope(input.scopeKey)) throw new CommunicationReferenceError('Channel scope does not exist');
}

export async function validateChannelParticipant(input: ChannelParticipant, lookup: CommunicationLookup) {
  const channel = await lookup.getChannel(input.channelKey);
  if (!channel || !matchesChannel(input, channel)) throw new CommunicationReferenceError('Participant channel and scope must match');
  if (input.userOrganizationKey && !await lookup.hasActiveScopeMember(input.scopeKey, input.userOrganizationKey)) throw new CommunicationReferenceError('Human participant requires active scope membership');
  if (input.orchestratorKey && !await lookup.hasOrchestratorScopeAccess(input.scopeKey, input.orchestratorKey)) throw new CommunicationReferenceError('Orchestrator does not have scope access');
}

export async function validateThread(input: Thread, lookup: CommunicationLookup) {
  const [channel, root] = await Promise.all([lookup.getChannel(input.channelKey), lookup.getMessage(input.rootMessageKey)]);
  if (!channel || !matchesChannel(input, channel) || !root || root.scopeKey !== input.scopeKey || root.channelKey !== input.channelKey) throw new CommunicationReferenceError('Thread root message must belong to its channel and scope');
}

export async function validateMessage(input: Message, lookup: CommunicationLookup) {
  const [channel, author, thread, reply] = await Promise.all([lookup.getChannel(input.channelKey), lookup.getParticipant(input.authorParticipantKey), input.threadKey ? lookup.getThread(input.threadKey) : null, input.replyToMessageKey ? lookup.getMessage(input.replyToMessageKey) : null]);
  if (!channel || !matchesChannel(input, channel)) throw new CommunicationReferenceError('Message channel and scope must match');
  if (!author || author.scopeKey !== input.scopeKey || author.channelKey !== input.channelKey) throw new CommunicationReferenceError('Message author must participate in its channel');
  if (thread && (!matchesChannel(thread, channel) || thread.scopeKey !== input.scopeKey)) throw new CommunicationReferenceError('Message thread must belong to its channel and scope');
  if (input.threadKey && !thread) throw new CommunicationReferenceError('Message thread does not exist');
  if (reply && (reply.scopeKey !== input.scopeKey || reply.channelKey !== input.channelKey || reply.threadKey !== input.threadKey)) throw new CommunicationReferenceError('Message reply must remain in the same channel and thread');
  if (input.replyToMessageKey && !reply) throw new CommunicationReferenceError('Message reply target does not exist');
}

async function validateMessageParticipant(input: MessageMention | MessageReaction, lookup: CommunicationLookup) {
  const [message, participant] = await Promise.all([lookup.getMessage(input.messageKey), lookup.getParticipant(input.participantKey)]);
  if (!message || message.scopeKey !== input.scopeKey || message.channelKey !== input.channelKey) throw new CommunicationReferenceError('Referenced message must match scope and channel');
  if (!participant || participant.scopeKey !== input.scopeKey || participant.channelKey !== input.channelKey) throw new CommunicationReferenceError('Referenced participant must match scope and channel');
}

export const validateMessageMention = validateMessageParticipant;
export const validateMessageReaction = validateMessageParticipant;
