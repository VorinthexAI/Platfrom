import { z } from 'zod';
import {
  channelLinkRelationSchema, channelLinkTargetCollectionSchema, channelParticipantRoleSchema,
  channelPinTargetCollectionSchema, keySchema, messageAttachmentTargetCollectionSchema,
  messageMentionTargetCollectionSchema,
} from './schema';

const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();
const mutationOptions = { atomic: z.boolean().default(false), idempotencyKey: idempotencyKeySchema };
const paginationOptions = { limit: z.number().int().min(1).max(100).default(50), cursor: keySchema.optional() };
const keys = z.array(keySchema).min(1).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);
const batch = <T extends z.ZodTypeAny>(field: string, item: T) => z.object({ [field]: z.array(item).min(1).max(100), ...mutationOptions }).strict();
const read = (field: string) => z.object({ [field]: keys, includeDeleted: z.boolean().default(false) }).strict();
const lifecycle = (field: string) => z.object({ [field]: keys, ...mutationOptions }).strict();
const list = (filters: z.ZodRawShape = {}) => z.object({ ...filters, includeDeleted: z.boolean().default(false), ...paginationOptions }).strict();

const channelCreate = z.object({ key: keySchema.optional(), scopeKey: keySchema, name: text(120), description: z.string().trim().max(4_000).optional(), type: z.enum(['public', 'private']), ownerUserKey: keySchema.optional(), ownerOrchestratorKey: keySchema.optional() }).strict().superRefine((value, context) => {
  if (Number(value.ownerUserKey !== undefined) + Number(value.ownerOrchestratorKey !== undefined) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one owner identity is required.', path: ['ownerUserKey'] });
});
const participant = z.object({ key: keySchema.optional(), channelKey: keySchema, userKey: keySchema.optional(), orchestratorKey: keySchema.optional(), role: channelParticipantRoleSchema }).strict().superRefine((value, context) => {
  if (Number(value.userKey !== undefined) + Number(value.orchestratorKey !== undefined) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one participant identity is required.', path: ['userKey'] });
});
const link = z.object({ key: keySchema.optional(), channelKey: keySchema, targetCollection: channelLinkTargetCollectionSchema, targetKey: keySchema, relation: channelLinkRelationSchema }).strict();
const thread = z.object({ key: keySchema.optional(), channelKey: keySchema, title: text(300).optional() }).strict();
const message = z.object({ key: keySchema.optional(), channelKey: keySchema, threadKey: keySchema, authorParticipantKey: keySchema, content: text(100_000), mentions: z.array(z.object({ targetCollection: messageMentionTargetCollectionSchema, targetKey: keySchema }).strict()).max(100).optional(), attachments: z.array(z.object({ targetCollection: messageAttachmentTargetCollectionSchema, targetKey: keySchema, displayName: text(255).optional() }).strict()).max(100).optional() }).strict();
const messageUpdate = z.object({ messageKey: keySchema, editedByParticipantKey: keySchema, content: text(100_000) }).strict();
const mention = z.object({ key: keySchema.optional(), messageKey: keySchema, targetCollection: messageMentionTargetCollectionSchema, targetKey: keySchema }).strict();
const reaction = z.object({ key: keySchema.optional(), messageKey: keySchema, participantKey: keySchema, emoji: text(32) }).strict();
const attachment = z.object({ key: keySchema.optional(), messageKey: keySchema, targetCollection: messageAttachmentTargetCollectionSchema, targetKey: keySchema, displayName: text(255).optional() }).strict();
const pin = z.object({ key: keySchema.optional(), channelKey: keySchema, threadKey: keySchema.optional(), targetCollection: channelPinTargetCollectionSchema, targetKey: keySchema, pinnedByParticipantKey: keySchema }).strict();
const poll = z.object({ key: keySchema.optional(), channelKey: keySchema, threadKey: keySchema, createdByParticipantKey: keySchema, question: text(2_000), multipleChoice: z.boolean(), closesAt: z.string().datetime().optional(), options: z.array(z.object({ key: keySchema.optional(), text: text(1_000), order: z.number().int().nonnegative().optional() }).strict()).min(2).max(100) }).strict();
const option = z.object({ key: keySchema.optional(), pollKey: keySchema, text: text(1_000), order: z.number().int().nonnegative().optional() }).strict();
const vote = z.object({ key: keySchema.optional(), pollKey: keySchema, optionKey: keySchema, participantKey: keySchema }).strict();
const channelUpdate = z.object({ channelKey: keySchema, name: text(120).optional(), description: z.string().trim().max(4_000).optional() }).strict().refine((value) => value.name !== undefined || value.description !== undefined);
const channelTypeUpdate = z.object({ channelKey: keySchema, type: z.enum(['public', 'private']) }).strict();
const participantRoleUpdate = z.object({ participantKey: keySchema, role: channelParticipantRoleSchema }).strict();
const linkUpdate = z.object({ linkKey: keySchema, relation: channelLinkRelationSchema }).strict();
const threadUpdate = z.object({ threadKey: keySchema, title: text(300) }).strict();
const messageMove = z.object({ messageKey: keySchema, threadKey: keySchema }).strict();
const attachmentUpdate = z.object({ attachmentKey: keySchema, displayName: text(255).optional() }).strict();
const pollUpdate = z.object({ pollKey: keySchema, question: text(2_000).optional(), multipleChoice: z.boolean().optional(), closesAt: z.string().datetime().nullable().optional() }).strict().refine((value) => value.question !== undefined || value.multipleChoice !== undefined || value.closesAt !== undefined);
const optionUpdate = z.object({ optionKey: keySchema, text: text(1_000) }).strict();
const optionReorder = z.object({ optionKey: keySchema, order: z.number().int().nonnegative() }).strict();
const voteChange = z.object({ pollKey: keySchema, participantKey: keySchema, optionKeys: keys }).strict();
const semanticSearch = (filters: z.ZodRawShape) => z.object({ query: text(4_000), organizationKey: keySchema.optional(), scopeKeys: keys.optional(), ...filters, limit: z.number().int().min(1).max(50).default(20) }).strict().superRefine((value, context) => {
  if (!value.organizationKey && !value.scopeKeys) context.addIssue({ code: z.ZodIssueCode.custom, message: 'organizationKey or scopeKeys is required.', path: ['organizationKey'] });
});

export const chorusToolInputSchemas = {
  'channel.create': batch('channels', channelCreate),
  'channel.find': read('channels'),
  'channel.list': list({ scopeKey: keySchema.optional(), type: z.enum(['public', 'private']).optional() }),
  'channel.update': batch('updates', channelUpdate),
  'channel.rename': batch('updates', z.object({ channelKey: keySchema, name: text(120) }).strict()),
  'channel.change-type': batch('updates', channelTypeUpdate),
  'channel.archive': lifecycle('channels'),
  'channel.restore': lifecycle('channels'),
  'channel.delete': lifecycle('channels'),
  'channel.participant.add': batch('participants', participant),
  'channel.participant.find': read('participants'),
  'channel.participant.list': list({ channelKey: keySchema, role: channelParticipantRoleSchema.optional(), userKey: keySchema.optional(), orchestratorKey: keySchema.optional() }),
  'channel.participant.update-role': batch('updates', participantRoleUpdate),
  'channel.participant.archive': lifecycle('participants'),
  'channel.participant.restore': lifecycle('participants'),
  'channel.participant.delete': lifecycle('participants'),
  'channel.link.create': batch('links', link),
  'channel.link.find': read('links'),
  'channel.link.list': list({ channelKey: keySchema, targetCollection: channelLinkTargetCollectionSchema.optional(), targetKey: keySchema.optional(), relation: channelLinkRelationSchema.optional() }),
  'channel.link.update': batch('updates', linkUpdate),
  'channel.link.archive': lifecycle('links'),
  'channel.link.restore': lifecycle('links'),
  'channel.link.delete': lifecycle('links'),
  'thread.create': batch('threads', thread),
  'thread.find': read('threads'),
  'thread.list': list({ channelKey: keySchema, resolved: z.boolean().optional() }),
  'thread.update': batch('updates', threadUpdate),
  'thread.rename': batch('updates', threadUpdate),
  'thread.resolve': batch('threads', z.object({ threadKey: keySchema }).strict()),
  'thread.reopen': batch('threads', z.object({ threadKey: keySchema }).strict()),
  'thread.archive': lifecycle('threads'),
  'thread.restore': lifecycle('threads'),
  'thread.delete': lifecycle('threads'),
  'message.create': batch('messages', message),
  'message.update': batch('messages', messageUpdate),
  'message.move': batch('moves', messageMove),
  'message.find': read('messages'),
  'message.list': list({ channelKey: keySchema.optional(), threadKey: keySchema.optional(), authorParticipantKey: keySchema.optional() }),
  'message.archive': lifecycle('messages'),
  'message.restore': lifecycle('messages'),
  'message.delete': lifecycle('messages'),
  'message.mention.create': batch('mentions', mention),
  'message.mention.find': read('mentions'),
  'message.mention.list': list({ messageKey: keySchema, targetCollection: messageMentionTargetCollectionSchema.optional(), targetKey: keySchema.optional() }),
  'message.mention.archive': lifecycle('mentions'),
  'message.mention.restore': lifecycle('mentions'),
  'message.mention.delete': lifecycle('mentions'),
  'message.reaction.add': batch('reactions', reaction),
  'message.reaction.find': read('reactions'),
  'message.reaction.list': list({ messageKey: keySchema, participantKey: keySchema.optional() }),
  'message.reaction.archive': lifecycle('reactions'),
  'message.reaction.restore': lifecycle('reactions'),
  'message.reaction.delete': lifecycle('reactions'),
  'message.attachment.create': batch('attachments', attachment),
  'message.attachment.find': read('attachments'),
  'message.attachment.list': list({ messageKey: keySchema, targetCollection: messageAttachmentTargetCollectionSchema.optional(), targetKey: keySchema.optional() }),
  'message.attachment.update': batch('updates', attachmentUpdate),
  'message.attachment.archive': lifecycle('attachments'),
  'message.attachment.restore': lifecycle('attachments'),
  'message.attachment.delete': lifecycle('attachments'),
  'message.edit.find': read('edits'),
  'message.edit.list': list({ messageKey: keySchema }),
  'message.edit.archive': lifecycle('edits'),
  'message.edit.restore': lifecycle('edits'),
  'message.edit.delete': lifecycle('edits'),
  'channel.pin.create': batch('pins', pin),
  'channel.pin.find': read('pins'),
  'channel.pin.list': list({ channelKey: keySchema, threadKey: keySchema.optional(), targetCollection: channelPinTargetCollectionSchema.optional(), targetKey: keySchema.optional() }),
  'channel.pin.archive': lifecycle('pins'),
  'channel.pin.restore': lifecycle('pins'),
  'channel.pin.delete': lifecycle('pins'),
  'poll.create': batch('polls', poll),
  'poll.find': read('polls'),
  'poll.list': list({ channelKey: keySchema.optional(), threadKey: keySchema.optional(), open: z.boolean().optional() }),
  'poll.update': batch('updates', pollUpdate),
  'poll.close': batch('polls', z.object({ pollKey: keySchema }).strict()),
  'poll.reopen': batch('polls', z.object({ pollKey: keySchema }).strict()),
  'poll.archive': lifecycle('polls'),
  'poll.restore': lifecycle('polls'),
  'poll.delete': lifecycle('polls'),
  'poll.option.create': batch('options', option),
  'poll.option.find': read('options'),
  'poll.option.list': list({ pollKey: keySchema }),
  'poll.option.update': batch('updates', optionUpdate),
  'poll.option.reorder': batch('updates', optionReorder),
  'poll.option.archive': lifecycle('options'),
  'poll.option.restore': lifecycle('options'),
  'poll.option.delete': lifecycle('options'),
  'poll.vote.cast': batch('votes', vote),
  'poll.vote.find': read('votes'),
  'poll.vote.list': list({ pollKey: keySchema, optionKey: keySchema.optional(), participantKey: keySchema.optional() }),
  'poll.vote.change': batch('changes', voteChange),
  'poll.vote.archive': lifecycle('votes'),
  'poll.vote.restore': lifecycle('votes'),
  'poll.vote.delete': lifecycle('votes'),
  'scope.channel.search': semanticSearch({ channelKeys: keys.optional(), type: z.enum(['public', 'private']).optional() }),
  'organization.channel.search': semanticSearch({ channelKeys: keys.optional(), linkedTargetKeys: keys.optional() }),
  'scope.message.search': semanticSearch({ channelKeys: keys.optional(), threadKeys: keys.optional(), authorParticipantKeys: keys.optional() }),
  'organization.message.search': semanticSearch({ channelKeys: keys.optional(), threadKeys: keys.optional(), participantKeys: keys.optional(), linkedTargetKeys: keys.optional() }),
} as const;

export type ChorusToolSlug = keyof typeof chorusToolInputSchemas;
export const CHORUS_TOOL_SLUGS = Object.keys(chorusToolInputSchemas) as ChorusToolSlug[];
export const isChorusToolSlug = (value: string): value is ChorusToolSlug => value in chorusToolInputSchemas;

type JsonSchema = Record<string, unknown>;
const schemaProperties: Record<string, JsonSchema> = {
  atomic: { type: 'boolean', default: false }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 255 }, includeDeleted: { type: 'boolean', default: false }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, cursor: { type: 'string', minLength: 1, maxLength: 255 }, organizationKey: { type: 'string', minLength: 1, maxLength: 255 }, scopeKeys: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 }, query: { type: 'string', minLength: 1, maxLength: 4_000 },
};
const jsonFor = (slug: ChorusToolSlug): JsonSchema => {
  const schema = chorusToolInputSchemas[slug];
  const objectSchema = schema instanceof z.ZodEffects ? schema._def.schema : schema;
  const shape = (objectSchema as z.AnyZodObject)._def.shape();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, value] of Object.entries(shape)) {
    const optional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
    if (!optional) required.push(name);
    properties[name] = schemaProperties[name] ?? (name.endsWith('s') ? { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false } } : { type: 'string' });
  }
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
};
export const chorusToolJsonSchemas: Record<ChorusToolSlug, JsonSchema> = Object.fromEntries(CHORUS_TOOL_SLUGS.map((slug) => [slug, jsonFor(slug)])) as Record<ChorusToolSlug, JsonSchema>;
export const CHORUS_TOOL_DEFINITIONS = CHORUS_TOOL_SLUGS.map((name) => ({ name, description: `Chorus ${name} operation.`, inputSchema: chorusToolJsonSchemas[name] }));
