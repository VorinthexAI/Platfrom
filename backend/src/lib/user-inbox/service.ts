import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createHash } from 'node:crypto';
import { newId } from '@/lib/ids';
import { enqueueAppNotification } from '@/lib/app-notifications/queue';
import { communicationHistoryInputSchema, communicationMarkReadInputSchema, communicationSendInputSchema, communicationStaffReplyInputSchema, communicationThreadInputSchema, userInboxMessageSchema } from './schemas';
import { getDefaultUserInboxRepository, type UserInboxRepository } from './repository';

export class UserInboxAccessError extends Error {}
export class UserInboxNotFoundError extends Error {}
export class UserInboxIdempotencyError extends Error {}

function actor(context: ToolContext) {
  const principal = context.principal;
  if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey || principal.userTeam.userId !== principal.user.key) throw new UserInboxAccessError('Active user membership is required.');
  return { userKey: principal.user.key, teamKey: context.teamKey, scopeKey: context.runtimeScopeKey };
}

export function createUserInboxService(options: { repository?: UserInboxRepository; id?: () => string; now?: () => string; enqueue?: typeof enqueueAppNotification } = {}) {
  const repository = options.repository ?? getDefaultUserInboxRepository();
  const id = options.id ?? newId;
  const now = options.now ?? (() => new Date().toISOString());
  const required = <T>(result: { state: 'ok'; value: T } | { state: 'not_found' }) => {
    if (result.state === 'not_found') throw new UserInboxNotFoundError('Communication thread was not found.');
    return result.value;
  };
  return {
    list(rawInput: unknown, context: ToolContext) { const value = actor(context); return repository.list(value.userKey, communicationHistoryInputSchema.parse(rawInput)); },
    async read(rawInput: unknown, context: ToolContext) { const value = actor(context); const input = communicationThreadInputSchema.parse(rawInput); return required(await repository.read(value.userKey, input.threadKey)); },
    async markRead(rawInput: unknown, context: ToolContext) { const value = actor(context); const input = communicationMarkReadInputSchema.parse(rawInput); return required(await repository.markRead(value.userKey, input.threadKey, input.read ? now() : null)); },
    async send(rawInput: unknown, context: ToolContext, rawIdempotencyKey = id()) {
      const value = actor(context); const input = communicationSendInputSchema.parse(rawInput); const createdAt = now();
      const idempotencyKey = userInboxMessageSchema.shape.idempotencyKey.unwrap().parse(rawIdempotencyKey);
      const requestHash = createHash('sha256').update(JSON.stringify({ threadKey: input.threadKey, message: input.message })).digest('hex');
      const result = await repository.send(value.userKey, userInboxMessageSchema.parse({ key: id(), threadKey: input.threadKey, teamKey: value.teamKey, scopeKey: value.scopeKey, userKey: value.userKey, sender: 'user', senderUserKey: value.userKey, body: input.message, idempotencyKey, requestHash, createdAt }), createdAt);
      if (result.state === 'conflict') throw new UserInboxIdempotencyError('Idempotency-Key was already used for a different follow-up.');
      return required(result);
    },
    async staffReply(rawInput: unknown, staffUserKey: string, idempotencyKey: string) {
      const input = communicationStaffReplyInputSchema.parse(rawInput); const stored = await repository.staffReply(staffUserKey, input.threadKey, id(), input.message, idempotencyKey, now());
      if (stored.state === 'conflict') throw new UserInboxIdempotencyError('Idempotency-Key was already used for a different staff reply.');
      const result = required(stored);
      if (result.deliveries > 0) await (options.enqueue ?? enqueueAppNotification)(result.notificationKey);
      return result.message;
    },
  };
}

export type UserInboxService = ReturnType<typeof createUserInboxService>;
export const userInboxService = createUserInboxService();
