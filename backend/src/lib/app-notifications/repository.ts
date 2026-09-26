import { createHash } from 'node:crypto';
import { db, withDatabaseTransaction } from '@/lib/db/client';
import { currentEmbeddingSchema, embeddingMetadata } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import type { AppNotifyInput, PushRegistrationInput } from './contracts';
import { encryptPushToken, pushTokenHash } from './token-crypto';

type QueryDatabase = Pick<typeof db, 'query'>;
type RegistrationTransaction = <T>(operation: (transaction: QueryDatabase) => Promise<T>) => Promise<T>;
export interface PendingPushDelivery { key: string; userKey: string; tokenCiphertext: string; projectId: string; title: string; message: string; notificationKey: string }
export interface PendingReceipt { key: string; receiptId: string }
export interface StorageRetentionWarningPersistenceInput {
  userKey: string;
  expectedPaymentPastDueAt: string;
  expectedWipeDueAt: string;
  title: string;
  message: string;
  embedding: number[];
  now: string;
  warningDayStart: string;
}

export function createAppNotificationRepository(
  database: QueryDatabase = db,
  registrationTransaction: RegistrationTransaction = (operation) => withDatabaseTransaction(database as typeof db, { write: ['pushSubscriptions'], exclusive: ['pushSubscriptions'] }, operation),
) {
  return {
    async register(userKey: string, installationKey: string, input: PushRegistrationInput) {
      const now = new Date().toISOString();
      const tokenHash = pushTokenHash(input.token);
      const tokenCiphertext = encryptPushToken(input.token);
      // ArangoDB cannot REMOVE and then UPSERT the same collection in one AQL
      // statement. Keep reassignment atomic across two statements, including
      // competing registrations of the same installation or provider token.
      return registrationTransaction(async (transaction) => {
        await transaction.query(`
          FOR item IN pushSubscriptions
            FILTER item.tokenHash == @tokenHash
            FILTER item.userKey != @userKey || item.installationKey != @installationKey
            REMOVE item IN pushSubscriptions
        `, { tokenHash, userKey, installationKey });
        const cursor = await transaction.query<{ key: string }>(`
          UPSERT { userKey: @userKey, installationKey: @installationKey }
            INSERT { _key: @key, userKey: @userKey, installationKey: @installationKey, tokenHash: @tokenHash, tokenCiphertext: @tokenCiphertext, projectId: @projectId, platform: @platform, createdAt: @now, updatedAt: @now }
            UPDATE { tokenHash: @tokenHash, tokenCiphertext: @tokenCiphertext, projectId: @projectId, platform: @platform, updatedAt: @now } IN pushSubscriptions
          RETURN { key: NEW._key }
        `, { key: newId(), userKey, installationKey, tokenHash, tokenCiphertext, projectId: input.projectId, platform: input.platform, now });
        return (await cursor.next())!;
      });
    },

    async unregister(userKey: string, installationKey: string) {
      const cursor = await database.query<number>('RETURN LENGTH(FOR item IN pushSubscriptions FILTER item.userKey == @userKey && item.installationKey == @installationKey REMOVE item IN pushSubscriptions RETURN 1)', { userKey, installationKey });
      return { removed: (await cursor.next() ?? 0) > 0 };
    },

    async resolveRecipientUserKeys(teamKey: string, scopeKey: string, requested?: string[]) {
      const cursor = await database.query<string>(`
        FOR membership IN userTeams
          FILTER membership.teamKey == @teamKey && membership.status == "active"
          FILTER @requested == null || membership.userId IN @requested
          LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userTeamKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
          FILTER membership.teamRole IN ["owner", "admin"] || scopeMember != null
          LET user = DOCUMENT(users, membership.userId)
          FILTER user != null && user.deletionRequestedAt == null
          RETURN user._key
      `, { teamKey, scopeKey, requested: requested ?? null });
      return await cursor.all();
    },

    async createNotification(input: AppNotifyInput, trusted: { actorUserKey: string; teamKey: string; scopeKey: string; idempotencyKey: string; destination?: { kind: 'email-thread'; connectorKey: string; threadKey: string; messageKey?: string } }, recipientUserKeys: string[], embedding: number[]) {
      const destination = trusted.destination ?? {};
      const requestHash = createHash('sha256').update(JSON.stringify({ title: input.title, message: input.message, notifyAll: input.notifyAll, userKeys: input.userKeys ? [...input.userKeys].sort() : undefined, recipientUserKeys: [...recipientUserKeys].sort(), destination })).digest('hex');
      const existingCursor = await database.query<{ key: string; requestHash: string; recipients: number; deliveries: number }>('FOR item IN appNotifications FILTER item.teamKey == @teamKey && item.actorUserKey == @actorUserKey && item.idempotencyKey == @idempotencyKey LIMIT 1 RETURN { key: item._key, requestHash: item.requestHash, recipients: item.recipientCount, deliveries: item.deliveryCount }', trusted);
      const existing = await existingCursor.next();
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error('Notification idempotency key was reused with different input.');
        return { key: existing.key, recipients: existing.recipients, deliveries: existing.deliveries, replayed: true };
      }
      const key = newId();
      const now = new Date().toISOString();
      const recipients = recipientUserKeys.map((userKey) => ({ userKey, key: newId() }));
      const cursor = await database.query<{ deliveries: number }>(`
        LET subscriptions = (FOR item IN pushSubscriptions FILTER item.userKey IN @recipientUserKeys RETURN item)
        INSERT { _key: @key, actorUserKey: @actorUserKey, teamKey: @teamKey, scopeKey: @scopeKey, idempotencyKey: @idempotencyKey, requestHash: @requestHash, title: @title, message: @message, recipientCount: LENGTH(@recipientUserKeys), deliveryCount: LENGTH(subscriptions), embedding: @embedding, embeddingState: "ready", embeddedAt: @now, embeddingProvider: @embeddingProvider, embeddingModel: @embeddingModel, embeddingDimensions: @embeddingDimensions, createdAt: @now } INTO appNotifications
        LET stored = (FOR recipient IN @recipients
          INSERT MERGE({ _key: recipient.key, userKey: recipient.userKey, teamKey: @teamKey, scopeKey: @scopeKey, title: @title, message: @message, readAt: null, sourceKey: @key, embedding: @embedding, createdAt: @now }, @destination) INTO userNotifications
          INSERT { _key: CONCAT(@key, "-", recipient.userKey), notificationKey: @key, userKey: recipient.userKey, teamKey: @teamKey, readAt: null, createdAt: @now, updatedAt: @now } INTO appNotificationRecipients RETURN 1)
        LET deliveries = (FOR subscription IN subscriptions INSERT { _key: CONCAT(@key, "-", subscription._key), notificationKey: @key, subscriptionKey: subscription._key, userKey: subscription.userKey, projectId: subscription.projectId, status: "queued", attempts: 0, createdAt: @now, updatedAt: @now } INTO pushDeliveries RETURN 1)
        RETURN { deliveries: LENGTH(deliveries) }
      `, { ...trusted, destination, key, requestHash, title: input.title, message: input.message, recipientUserKeys, recipients, embedding: currentEmbeddingSchema.parse(embedding), ...embeddingMetadata(), now });
      const result = (await cursor.next())!;
      return { key, recipients: recipientUserKeys.length, deliveries: result.deliveries, replayed: false };
    },

    async createStorageRetentionWarning(input: StorageRetentionWarningPersistenceInput) {
      const key = newId();
      const userNotificationKey = newId();
      const idempotencyKey = createHash('sha256').update(`storage-retention-warning\0${input.userKey}\0${input.expectedPaymentPastDueAt}\0${input.expectedWipeDueAt}\0${input.now}`).digest('hex');
      const requestHash = createHash('sha256').update(JSON.stringify({ title: input.title, message: input.message, userKey: input.userKey, expectedPaymentPastDueAt: input.expectedPaymentPastDueAt, expectedWipeDueAt: input.expectedWipeDueAt })).digest('hex');
      const cursor = await database.query<{ key: string; deliveries: number }>(`
        LET state = FIRST(FOR item IN storageRetentionStates FILTER item.userKey == @userKey LIMIT 1 RETURN item)
        LET user = DOCUMENT(users, @userKey)
        LET team = FIRST(FOR item IN teams FILTER item.personalOwnerUserId == @userKey && item.isActive == true LIMIT 1 RETURN item)
        LET scope = team == null ? null : FIRST(FOR item IN scopes FILTER item.teamKey == team._key && item.slug == "main" LIMIT 1 RETURN item)
        FILTER state != null && user != null && team != null && scope != null
        FILTER state.paymentPastDueAt == @expectedPaymentPastDueAt && state.wipeDueAt == @expectedWipeDueAt
        FILTER state.fundedAt == null && state.wipeStartedAt == null && state.wipedAt == null && state.wipeDueAt > @now
        FILTER (IS_NUMBER(user.microSparkDebt) && user.microSparkDebt > 0) || (!IS_NUMBER(user.microSparkBalance) ? 0 : user.microSparkBalance) < state.minimumBalanceMicroSparks
        FILTER state.warningWipeDueAt != @expectedWipeDueAt || state.warningPaymentPastDueAt != @expectedPaymentPastDueAt || !IS_STRING(state.warningSentAt) || state.warningSentAt < @warningDayStart
        UPDATE state WITH { warningPaymentPastDueAt: @expectedPaymentPastDueAt, warningWipeDueAt: @expectedWipeDueAt, warningSentAt: @now } IN storageRetentionStates
        LET subscriptions = (FOR item IN pushSubscriptions FILTER item.userKey == @userKey RETURN item)
        INSERT { _key: @key, actorUserKey: @userKey, teamKey: team._key, scopeKey: scope._key, idempotencyKey: @idempotencyKey, requestHash: @requestHash, title: @title, message: @message, recipientCount: 1, deliveryCount: LENGTH(subscriptions), embedding: @embedding, embeddingState: "ready", embeddedAt: @now, embeddingProvider: @embeddingProvider, embeddingModel: @embeddingModel, embeddingDimensions: @embeddingDimensions, createdAt: @now } INTO appNotifications
        INSERT { _key: @userNotificationKey, userKey: @userKey, teamKey: team._key, scopeKey: scope._key, title: @title, message: @message, readAt: null, sourceKey: @key, embedding: @embedding, createdAt: @now } INTO userNotifications
        INSERT { _key: CONCAT(@key, "-", @userKey), notificationKey: @key, userKey: @userKey, teamKey: team._key, readAt: null, createdAt: @now, updatedAt: @now } INTO appNotificationRecipients
        LET deliveries = (FOR subscription IN subscriptions INSERT { _key: CONCAT(@key, "-", subscription._key), notificationKey: @key, subscriptionKey: subscription._key, userKey: subscription.userKey, projectId: subscription.projectId, status: "queued", attempts: 0, createdAt: @now, updatedAt: @now } INTO pushDeliveries RETURN 1)
        RETURN { key: @key, deliveries: LENGTH(deliveries) }
      `, { ...input, key, userNotificationKey, idempotencyKey, requestHash, ...embeddingMetadata() });
      const result = await cursor.next();
      return result ? { ...result, recipients: 1, replayed: false } : null;
    },

    async pendingDeliveries(notificationKey: string): Promise<PendingPushDelivery[]> {
      const cursor = await database.query<PendingPushDelivery>(`
        FOR delivery IN pushDeliveries
          FILTER delivery.notificationKey == @notificationKey && delivery.status == "queued"
          LET subscription = DOCUMENT(pushSubscriptions, delivery.subscriptionKey)
          LET notification = FIRST(FOR item IN userNotifications FILTER item.sourceKey == delivery.notificationKey && item.userKey == delivery.userKey LIMIT 1 RETURN item)
          FILTER subscription != null && notification != null
          RETURN { key: delivery._key, userKey: delivery.userKey, tokenCiphertext: subscription.tokenCiphertext, projectId: subscription.projectId, title: notification.title, message: notification.message, notificationKey: delivery.notificationKey }
      `, { notificationKey });
      return await cursor.all();
    },

    async suppressDeliveries(deliveryKeys: string[]) {
      if (!deliveryKeys.length) return;
      await database.query('FOR delivery IN pushDeliveries FILTER delivery._key IN @deliveryKeys && delivery.status == "queued" UPDATE delivery WITH { status: "suppressed_active", updatedAt: DATE_ISO8601(DATE_NOW()) } IN pushDeliveries', { deliveryKeys });
    },

    async recordTickets(results: Array<{ key: string; status: 'queued' | 'receipt_pending' | 'failed'; receiptId?: string; error?: string; deviceNotRegistered?: boolean }>) {
      if (!results.length) return;
      await database.query('FOR result IN @results LET delivery = DOCUMENT(pushDeliveries, result.key) FILTER delivery != null LET removeToken = result.deviceNotRegistered ? (FOR subscription IN pushSubscriptions FILTER subscription._key == delivery.subscriptionKey REMOVE subscription IN pushSubscriptions RETURN 1) : [] UPDATE delivery WITH { status: result.status, receiptId: result.receiptId, providerError: result.error, attempts: delivery.attempts + 1, receiptDueAt: result.status == "receipt_pending" ? DATE_ISO8601(DATE_ADD(DATE_NOW(), 15, "minutes")) : null, updatedAt: DATE_ISO8601(DATE_NOW()) } IN pushDeliveries OPTIONS { keepNull: false }', { results });
    },

    async pendingReceipts(notificationKey: string): Promise<PendingReceipt[]> {
      const cursor = await database.query<PendingReceipt>('FOR item IN pushDeliveries FILTER item.notificationKey == @notificationKey && item.status == "receipt_pending" && IS_STRING(item.receiptId) RETURN { key: item._key, receiptId: item.receiptId }', { notificationKey });
      return await cursor.all();
    },

    async recordReceipts(results: Array<{ key: string; status: 'accepted' | 'failed'; error?: string; deviceNotRegistered?: boolean }>) {
      if (!results.length) return;
      await database.query(`
        FOR result IN @results
          LET delivery = DOCUMENT(pushDeliveries, result.key)
          FILTER delivery != null
          LET removeToken = result.deviceNotRegistered ? (FOR subscription IN pushSubscriptions FILTER subscription._key == delivery.subscriptionKey REMOVE subscription IN pushSubscriptions RETURN 1) : []
          UPDATE delivery WITH { status: result.status, providerError: result.error, updatedAt: DATE_ISO8601(DATE_NOW()) } IN pushDeliveries OPTIONS { keepNull: false }
      `, { results });
    },

    async recoverableNotificationKeys() {
      const cursor = await database.query<string>('FOR item IN pushDeliveries FILTER item.status == "queued" COLLECT key = item.notificationKey RETURN key');
      return await cursor.all();
    },
  };
}

export type AppNotificationRepository = ReturnType<typeof createAppNotificationRepository>;
export const appNotificationRepository = createAppNotificationRepository();
