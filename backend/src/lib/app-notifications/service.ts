import { z } from 'zod';
import { rankAccessRole } from '@/lib/ai/tools/domain-access-engine';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { appNotifyInputSchema, type AppNotifyInput, notificationListInputSchema, type NotificationListInput, pushRegistrationInputSchema, type PushRegistrationInput } from './contracts';
import { appNotificationRepository, type AppNotificationRepository } from './repository';
import { enqueueAppNotification } from './queue';
import { createUserInboxService, type UserInboxService } from '@/lib/user-inbox/service';

export class AppNotificationAccessError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1_000;
const storageRetentionWarningInputSchema = z.object({
  userKey: z.string().min(1).max(160),
  paymentPastDueAt: z.string().datetime(),
  wipeDueAt: z.string().datetime(),
  monthlyCostSparks: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/),
  now: z.string().datetime(),
}).strict();

export function storageRetentionWarningContent(monthlyCostSparks: string, wipeDueAt: string, now: string) {
  const cost = storageRetentionWarningInputSchema.shape.monthlyCostSparks.parse(monthlyCostSparks);
  const remainingMs = Date.parse(z.string().datetime().parse(wipeDueAt)) - Date.parse(z.string().datetime().parse(now));
  const days = Math.ceil(remainingMs / DAY_MS);
  if (cost === '0' || days <= 0) return null;
  return {
    title: 'Your storage needs Sparks',
    message: `Your stored data costs ${cost} ${cost === '1' ? 'Spark' : 'Sparks'} a month and will be deleted in ${days} ${days === 1 ? 'day' : 'days'} unless Sparks are refilled.`,
  };
}

export function createAppNotificationService(dependencies: { repository?: AppNotificationRepository; inbox?: UserInboxService; enqueue?: typeof enqueueAppNotification; embed?: (text: string) => Promise<number[]> } = {}) {
  const repository = dependencies.repository ?? appNotificationRepository;
  const enqueue = dependencies.enqueue ?? enqueueAppNotification;
  const activeMember = (context: ToolContext) => {
    const principal = context.principal;
    if (principal.kind !== 'member' || principal.userTeam.status !== 'active' || principal.userTeam.teamKey !== context.teamKey) throw new AppNotificationAccessError('Active team membership is required.');
    return principal;
  };
  return {
    register(userKey: string, installationKey: string, rawInput: PushRegistrationInput) {
      return repository.register(userKey, installationKey, pushRegistrationInputSchema.parse(rawInput));
    },
    unregister(userKey: string, installationKey: string) { return repository.unregister(userKey, installationKey); },
    async notify(rawInput: AppNotifyInput, context: ToolContext, idempotencyKey = newId()) {
      const input = appNotifyInputSchema.parse(rawInput);
      const principal = activeMember(context);
      const actorUserKey = principal.user.key;
      const requested = input.notifyAll ? undefined : input.userKeys;
      const targetsOthers = input.notifyAll || requested!.some((key) => key !== actorUserKey);
      if (targetsOthers && rankAccessRole(principal.userTeam.teamRole === 'member' ? 'viewer' : principal.userTeam.teamRole) < rankAccessRole('moderator')) throw new AppNotificationAccessError('Moderator access is required to notify other users.');
      const recipientUserKeys = await repository.resolveRecipientUserKeys(context.teamKey, context.runtimeScopeKey, requested);
      if (requested && (recipientUserKeys.length !== requested.length || new Set(recipientUserKeys).size !== requested.length || requested.some((key) => !recipientUserKeys.includes(key)))) throw new AppNotificationAccessError('Every recipient must be an active user in the current team.');
      const embedding = currentEmbeddingSchema.parse(await (dependencies.embed ?? ((text) => embedText({ text, purpose: 'document' })))(`${input.title}\n\n${input.message}`));
      const result = await repository.createNotification(input, { actorUserKey, teamKey: context.teamKey, scopeKey: context.runtimeScopeKey, idempotencyKey }, recipientUserKeys, embedding);
      if (result.deliveries > 0) await enqueue(result.key);
      return result;
    },
    async notifyStorageRetentionWarning(rawInput: z.input<typeof storageRetentionWarningInputSchema>) {
      const input = storageRetentionWarningInputSchema.parse(rawInput);
      const content = storageRetentionWarningContent(input.monthlyCostSparks, input.wipeDueAt, input.now);
      if (!content) return null;
      const embeddingText = `${content.title}\n\n${content.message}`;
      const embedding = currentEmbeddingSchema.parse(await (dependencies.embed ?? ((text) => embedText({ text, purpose: 'document' })))(embeddingText));
      const result = await repository.createStorageRetentionWarning({
        userKey: input.userKey,
        expectedPaymentPastDueAt: input.paymentPastDueAt,
        expectedWipeDueAt: input.wipeDueAt,
        ...content,
        embedding,
        now: input.now,
        warningDayStart: `${input.now.slice(0, 10)}T00:00:00.000Z`,
      });
      if (result && result.deliveries > 0) await enqueue(result.key);
      return result;
    },
    async list(rawInput: NotificationListInput, context: ToolContext) {
      activeMember(context);
      return (dependencies.inbox ?? createUserInboxService()).list(notificationListInputSchema.parse(rawInput), context);
    },
  };
}

export type AppNotificationService = ReturnType<typeof createAppNotificationService>;
export const appNotificationService = createAppNotificationService();
