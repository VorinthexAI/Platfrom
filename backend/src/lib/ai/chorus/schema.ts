import { z } from 'zod';

export const CHORUS_COLLECTIONS = [
  'channels', 'channelParticipants', 'channelLinks', 'threads', 'messages',
  'messageMentions', 'messageReactions', 'messageAttachments', 'messageEdits',
  'channelPins', 'polls', 'pollOptions', 'pollVotes',
] as const;
export type ChorusCollection = typeof CHORUS_COLLECTIONS[number];

export const keySchema = z.string().trim().min(1).max(255);
export const isoDateTimeSchema = z.string().datetime();
export const embeddingSchema = z.array(z.number().finite()).max(8192);
export const semanticEmbeddingSchema = embeddingSchema.min(1);
export const emptyEmbeddingSchema = z.tuple([]);
export const baseNodeSchema = z.object({
  key: keySchema,
  embedding: embeddingSchema,
  deletedAt: isoDateTimeSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const channelTypeSchema = z.enum(['public', 'private']);
export const channelSchema = baseNodeSchema.extend({
  scopeKey: keySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).optional(),
  type: channelTypeSchema,
});

export const channelParticipantRoleSchema = z.enum(['member', 'moderator', 'owner']);
export const channelParticipantSchema = baseNodeSchema.extend({
  scopeKey: keySchema,
  channelKey: keySchema,
  userKey: keySchema.optional(),
  orchestratorKey: keySchema.optional(),
  role: channelParticipantRoleSchema,
}).superRefine((value, context) => {
  if (Number(value.userKey !== undefined) + Number(value.orchestratorKey !== undefined) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of userKey or orchestratorKey must be provided.', path: ['userKey'] });
  }
  if (value.embedding.length !== 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Participant embeddings must be empty.', path: ['embedding'] });
});

export const channelLinkTargetCollectionSchema = z.enum(['projects', 'milestones', 'tasks', 'folders', 'documents', 'events', 'meetings']);
export const channelLinkRelationSchema = z.enum(['primary', 'discussion', 'support', 'updates', 'reference']);
export const channelLinkSchema = baseNodeSchema.extend({
  scopeKey: keySchema, channelKey: keySchema, targetCollection: channelLinkTargetCollectionSchema, targetKey: keySchema, relation: channelLinkRelationSchema,
}).refine((value) => value.embedding.length === 0, { message: 'Link embeddings must be empty.', path: ['embedding'] });

export const threadSchema = baseNodeSchema.extend({
  scopeKey: keySchema, channelKey: keySchema, title: z.string().trim().min(1).max(300).optional(), isRoot: z.boolean().default(false), resolvedAt: isoDateTimeSchema.optional(),
}).superRefine((value, context) => {
  if (value.title && value.embedding.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Titled threads require an embedding.', path: ['embedding'] });
  if (!value.title && value.embedding.length !== 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Untitled threads must have an empty embedding.', path: ['embedding'] });
});

export const messageSchema = baseNodeSchema.extend({
  scopeKey: keySchema, channelKey: keySchema, threadKey: keySchema, authorParticipantKey: keySchema, content: z.string().trim().min(1).max(100_000),
}).refine((value) => value.embedding.length > 0, { message: 'Messages require an embedding.', path: ['embedding'] });

export const messageMentionTargetCollectionSchema = z.enum(['channelParticipants', 'projects', 'milestones', 'tasks', 'folders', 'documents', 'channels', 'threads']);
export const messageMentionSchema = baseNodeSchema.extend({ scopeKey: keySchema, messageKey: keySchema, targetCollection: messageMentionTargetCollectionSchema, targetKey: keySchema })
  .refine((value) => value.embedding.length === 0, { message: 'Mention embeddings must be empty.', path: ['embedding'] });
export const messageReactionSchema = baseNodeSchema.extend({ scopeKey: keySchema, messageKey: keySchema, participantKey: keySchema, emoji: z.string().trim().min(1).max(32) })
  .refine((value) => value.embedding.length === 0, { message: 'Reaction embeddings must be empty.', path: ['embedding'] });
export const messageAttachmentTargetCollectionSchema = z.enum(['documents', 'folders']);
export const messageAttachmentSchema = baseNodeSchema.extend({ scopeKey: keySchema, messageKey: keySchema, targetCollection: messageAttachmentTargetCollectionSchema, targetKey: keySchema, displayName: z.string().trim().max(255).optional() })
  .refine((value) => value.embedding.length === 0, { message: 'Attachment embeddings must be empty.', path: ['embedding'] });
export const messageEditSchema = baseNodeSchema.extend({ scopeKey: keySchema, messageKey: keySchema, previousContent: z.string().max(100_000), editedByParticipantKey: keySchema, editSequence: z.number().int().positive() })
  .refine((value) => value.embedding.length === 0, { message: 'Edit embeddings must be empty.', path: ['embedding'] });

export const channelPinTargetCollectionSchema = z.enum(['messages', 'threads', 'documents', 'folders', 'projects', 'milestones', 'tasks']);
export const channelPinSchema = baseNodeSchema.extend({ scopeKey: keySchema, channelKey: keySchema, threadKey: keySchema.optional(), targetCollection: channelPinTargetCollectionSchema, targetKey: keySchema, pinnedByParticipantKey: keySchema })
  .refine((value) => value.embedding.length === 0, { message: 'Pin embeddings must be empty.', path: ['embedding'] });

export const pollSchema = baseNodeSchema.extend({ scopeKey: keySchema, channelKey: keySchema, threadKey: keySchema, createdByParticipantKey: keySchema, question: z.string().trim().min(1).max(2000), multipleChoice: z.boolean(), closesAt: isoDateTimeSchema.optional(), closedAt: isoDateTimeSchema.optional() })
  .refine((value) => value.embedding.length > 0, { message: 'Polls require an embedding.', path: ['embedding'] });
export const pollOptionSchema = baseNodeSchema.extend({ scopeKey: keySchema, pollKey: keySchema, text: z.string().trim().min(1).max(1000), order: z.number().int().nonnegative() })
  .refine((value) => value.embedding.length > 0, { message: 'Poll options require an embedding.', path: ['embedding'] });
export const pollVoteSchema = baseNodeSchema.extend({ scopeKey: keySchema, pollKey: keySchema, optionKey: keySchema, participantKey: keySchema })
  .refine((value) => value.embedding.length === 0, { message: 'Vote embeddings must be empty.', path: ['embedding'] });

export const chorusSchemas = {
  channels: channelSchema, channelParticipants: channelParticipantSchema, channelLinks: channelLinkSchema, threads: threadSchema, messages: messageSchema,
  messageMentions: messageMentionSchema, messageReactions: messageReactionSchema, messageAttachments: messageAttachmentSchema, messageEdits: messageEditSchema,
  channelPins: channelPinSchema, polls: pollSchema, pollOptions: pollOptionSchema, pollVotes: pollVoteSchema,
} as const;

export const semanticCollections = new Set<ChorusCollection>(['channels', 'messages', 'polls', 'pollOptions']);
export function channelEmbeddingInput(channel: Pick<z.infer<typeof channelSchema>, 'name' | 'description'>) { return `${channel.name}\n\n${channel.description ?? ''}`.trim(); }
export function threadEmbeddingInput(thread: Pick<z.infer<typeof threadSchema>, 'title'>) { return thread.title?.trim() ?? ''; }
export function messageEmbeddingInput(message: Pick<z.infer<typeof messageSchema>, 'content'>) { return message.content; }
export function pollEmbeddingInput(poll: Pick<z.infer<typeof pollSchema>, 'question'>) { return poll.question; }
export function pollOptionEmbeddingInput(option: Pick<z.infer<typeof pollOptionSchema>, 'text'>) { return option.text; }

export type Channel = z.infer<typeof channelSchema>;
export type ChannelParticipant = z.infer<typeof channelParticipantSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Poll = z.infer<typeof pollSchema>;
export type PollOption = z.infer<typeof pollOptionSchema>;
export type PollVote = z.infer<typeof pollVoteSchema>;
