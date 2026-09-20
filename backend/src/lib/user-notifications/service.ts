import { z } from 'zod';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { userNotificationListInputSchema, userNotificationListResultSchema, userNotificationMarkReadInputSchema, safeUserNotificationSchema, type SafeUserNotification } from './schemas';
import { InvalidUserNotificationCursorError, userNotificationRepository, type UserNotificationRepository } from './repository';

export class UserNotificationAccessError extends Error {
  readonly code = 'NOTIFICATION_FORBIDDEN';
}

export class UserNotificationNotFoundError extends Error {
  readonly code = 'NOTIFICATION_NOT_FOUND';
}

export { InvalidUserNotificationCursorError };

function memberUserKey(context: ToolContext) {
  if (context.principal.kind !== 'member') throw new UserNotificationAccessError('Active member principal is required.');
  const { user, userTeam } = context.principal;
  if (userTeam.status !== 'active' || userTeam.teamKey !== context.teamKey || userTeam.userId !== user.key) throw new UserNotificationAccessError('Active member principal must match the notification team and user.');
  return z.string().cuid().parse(user.key);
}

export interface UserNotificationService {
  list(input: z.input<typeof userNotificationListInputSchema>, context: ToolContext): Promise<{ items: SafeUserNotification[]; nextCursor: string | null }>;
  get(notificationKey: string, context: ToolContext): Promise<SafeUserNotification>;
  search(embedding: number[], query: string, context: ToolContext, input: { readState?: 'read' | 'unread'; createdFrom?: string; createdTo?: string; limit: number }): Promise<Array<SafeUserNotification & { score: number }>>;
  markRead(input: z.input<typeof userNotificationMarkReadInputSchema>, context: ToolContext): Promise<SafeUserNotification>;
}

export function createUserNotificationService(options: { repository?: UserNotificationRepository; now?: () => string } = {}): UserNotificationService {
  const repository = options.repository ?? userNotificationRepository;
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async list(rawInput, context) {
      const userKey = memberUserKey(context);
      return userNotificationListResultSchema.parse(await repository.list(userKey, userNotificationListInputSchema.parse(rawInput)));
    },
    async get(notificationKey, context) {
      const userKey = memberUserKey(context);
      const value = await repository.get(userKey, z.string().cuid().parse(notificationKey));
      if (!value) throw new UserNotificationNotFoundError('Notification was not found.');
      return safeUserNotificationSchema.parse({ key: value.key, title: value.title, message: value.message, isRead: value.readAt !== null, createdAt: value.createdAt });
    },
    async search(embedding, query, context, input) {
      return repository.search(memberUserKey(context), embedding, query, input);
    },
    async markRead(rawInput, context) {
      const userKey = memberUserKey(context);
      const input = userNotificationMarkReadInputSchema.parse(rawInput);
      const value = await repository.markRead(userKey, input.notificationKey, input.read ? now() : null);
      if (!value) throw new UserNotificationNotFoundError('Notification was not found.');
      return value;
    },
  };
}

export const userNotificationService = createUserNotificationService();
