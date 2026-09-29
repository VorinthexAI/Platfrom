import type { Database } from 'arangojs';

export interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
  embedKeys?: string[];
  skipEmbedding?: boolean;
}

export const collections: CollectionSpec[] = [
  { name: 'users', embedKeys: ['email', 'name'], indexes: [{ fields: ['email'], unique: true }, { fields: ['emailHash'], unique: true }, { fields: ['alias_slug'], unique: true, sparse: true }, { fields: ['profileStorageKey'], unique: true, sparse: true }, { fields: ['currentScopeKey'] }] },
  { name: 'sparkTransactions', skipEmbedding: true, indexes: [{ fields: ['userKey', 'idempotencyKey'], unique: true }, { fields: ['userKey', 'createdAt'] }, { fields: ['eventKey'], unique: true, sparse: true }] },
  { name: 'newcomerGrantClaims', skipEmbedding: true, indexes: [{ fields: ['userKey'] }] },
  { name: 'products', skipEmbedding: true, indexes: [{ fields: ['productId'], unique: true }, { fields: ['providerProductId'], unique: true, sparse: true }, { fields: ['active', 'productId'] }] },
  { name: 'paymentCheckouts', skipEmbedding: true, indexes: [{ fields: ['userKey', 'idempotencyKey'], unique: true }, { fields: ['providerCheckoutId'], unique: true, sparse: true }, { fields: ['userKey', 'createdAt'] }, { fields: ['status', 'updatedAt'] }] },
  { name: 'checkoutHandoffs', skipEmbedding: true, indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['issuanceKey'], unique: true }, { fields: ['expiresAt'] }, { fields: ['userKey', 'createdAt'] }, { fields: ['claimLeaseExpiresAt'], sparse: true }] },
  { name: 'paymentOrders', skipEmbedding: true, indexes: [{ fields: ['providerOrderId'], unique: true }, { fields: ['sparkTransactionKey'], unique: true, sparse: true }, { fields: ['userKey', 'paidAt'] }, { fields: ['providerSubscriptionId', 'paidAt'], sparse: true }, { fields: ['status', 'updatedAt'] }] },
  { name: 'subscriptions', skipEmbedding: true, indexes: [{ fields: ['providerSubscriptionId'], unique: true }, { fields: ['userKey', 'updatedAt'] }, { fields: ['userKey', 'status'] }] },
  { name: 'commerceReconciliationRuns', skipEmbedding: true, indexes: [{ fields: ['windowStart'], unique: true }, { fields: ['status', 'windowStart'] }] },
  { name: 'referralCodes', skipEmbedding: true, indexes: [{ fields: ['code'], unique: true }, { fields: ['ownerUserKey', 'programVersion'], unique: true }] },
  { name: 'referralAttributions', skipEmbedding: true, indexes: [{ fields: ['referredUserKey', 'programVersion'], unique: true }, { fields: ['referrerUserKey', 'programVersion', 'createdAt'] }, { fields: ['referralCodeKey'] }] },
  { name: 'referralRewards', skipEmbedding: true, indexes: [{ fields: ['attributionKey', 'milestone', 'programVersion'], unique: true }, { fields: ['referrerUserKey', 'programVersion', 'createdAt'] }, { fields: ['sparkTransactionKey'], unique: true, sparse: true }, { fields: ['qualifyingPaymentKey'], unique: true, sparse: true }] },
  { name: 'billingExecutions', skipEmbedding: true, indexes: [{ fields: ['userKey', 'executionIdentity'], unique: true }, { fields: ['status', 'leaseExpiresAt'] }, { fields: ['chargeTransactionKey'], unique: true }] },
  { name: 'storageObjects', skipEmbedding: true, indexes: [{ fields: ['storageKey', 'deletedAt'] }, { fields: ['userKey', 'storedAt'] }, { fields: ['storedAt'] }] },
  { name: 'storageChargingHours', skipEmbedding: true, indexes: [{ fields: ['kind', 'hourEnd'] }, { fields: ['userKey', 'hourStart'], unique: true, sparse: true }, { fields: ['status', 'hourStart'] }] },
  { name: 'storageChargingMeters', skipEmbedding: true, indexes: [{ fields: ['userKey'], unique: true }] },
  { name: 'storageRetentionStates', skipEmbedding: true, indexes: [{ fields: ['userKey'], unique: true }, { fields: ['wipeDueAt'] }, { fields: ['fundedAt', 'wipedAt'] }] },
  { name: 'pushSubscriptions', skipEmbedding: true, indexes: [{ fields: ['userKey', 'installationKey'], unique: true }, { fields: ['tokenHash'], unique: true }, { fields: ['userKey'] }] },
  { name: 'userNotifications', embedKeys: ['title', 'message'], indexes: [{ fields: ['userKey', 'createdAt'] }, { fields: ['userKey', 'readAt', 'createdAt'] }, { fields: ['sourceKey', 'userKey'], unique: true, sparse: true }] },
  { name: 'pushDeliveries', skipEmbedding: true, indexes: [{ fields: ['notificationKey', 'subscriptionKey'], unique: true }, { fields: ['notificationKey', 'status'] }, { fields: ['status', 'receiptDueAt'], sparse: true }, { fields: ['userKey', 'createdAt'] }] },
  { name: 'authSessions', skipEmbedding: true, indexes: [{ fields: ['userId'] }, { fields: ['refreshTokenHash'], unique: true }, { fields: ['expiresAt'] }, { fields: ['userId', 'revokedAt'] }] },
  { name: 'events', skipEmbedding: true, indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['userId', 'createdAt'], sparse: true }, { fields: ['scopeKey', 'createdAt'] }, { fields: ['eventIdentifier', 'createdAt'] }] },
  { name: 'processedWebhookEvents', skipEmbedding: true, indexes: [{ fields: ['provider', 'eventId'], unique: true }, { fields: ['status', 'processedAt'] }] },
  { name: 'authChallenges', indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['identityKey', 'identityType', 'kind'] }, { fields: ['expiresAt'] }] },
  { name: 'visitors', indexes: [{ fields: ['distinctId'], unique: true, sparse: true }] },
  { name: 'visitorSessions', indexes: [{ fields: ['visitorId'] }, { fields: ['source'] }, { fields: ['sessionKey'], unique: true }, { fields: ['disconnectedAt'] }] },
  { name: 'userSessions', indexes: [{ fields: ['userId'] }, { fields: ['source'] }, { fields: ['sessionKey'], unique: true }, { fields: ['disconnectedAt'] }, { fields: ['userId', 'connectedAt'] }] },
  { name: 'scopes', embedKeys: ['name', 'slug', 'description'], indexes: [{ fields: ['userKey', 'slug'], unique: true }, { fields: ['userKey', 'position'] }] },
  { name: 'folders', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'parentFolderKey'] }, { fields: ['scopeKey', 'parentFolderKey', 'name'] }, { fields: ['userKey', 'scopeKey'] }] },
  { name: 'files', embedKeys: ['name', 'extractedText'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'folderKey'] }, { fields: ['storageKey'], unique: true }, { fields: ['userKey', 'scopeKey'] }, { fields: ['scopeKey', 'processing'] }] },
  { name: 'contentIdempotency', skipEmbedding: true, indexes: [{ fields: ['userKey', 'tool', 'idempotencyKey'], unique: true }, { fields: ['leaseExpiresAt'], sparse: true }, { fields: ['expiresAt'], sparse: true }] },
  { name: 'conversations', skipEmbedding: true, indexes: [{ fields: ['userKey', 'scopeKey', 'isFavorite', 'updatedAt'] }, { fields: ['userKey', 'scopeKey', 'updatedAt'] }] },
  { name: 'conversationMessages', skipEmbedding: true, indexes: [{ fields: ['conversationKey', 'userKey', 'turnKey', 'role'], unique: true }, { fields: ['userKey', 'scopeKey', 'conversationKey', 'createdAt'] }, { fields: ['conversationKey', 'role', 'status'] }, { fields: ['guideTopics.status', 'guideTopicGeneration'] }] },
  { name: 'conversationAttachmentArtifacts', skipEmbedding: true, indexes: [{ fields: ['conversationKey', 'requestKey'] }, { fields: ['userKey', 'scopeKey', 'conversationKey'] }, { fields: ['expiresAt'] }, { fields: ['status', 'availableAt'] }] },
  { name: 'tickets', embedKeys: ['message'], indexes: [{ fields: ['scopeKey', 'type', 'createdAt'] }, { fields: ['userKey', 'scopeKey', 'createdAt'] }, { fields: ['userKey', 'idempotencyKey'], unique: true }] },
  { name: 'ticketVotes', skipEmbedding: true, indexes: [{ fields: ['ticketKey', 'userKey'], unique: true }, { fields: ['scopeKey', 'ticketKey'] }, { fields: ['userKey'] }] },
  { name: 'storageDeletionJobs', skipEmbedding: true, indexes: [{ fields: ['storageKey'], unique: true }, { fields: ['createdAt'] }, { fields: ['status'] }, { fields: ['reservationExpiresAt'], sparse: true }, { fields: ['claimedAt'], sparse: true }] },
];

export async function migrateSchema(targetDb: Database) {
  for (const spec of collections) {
    const collection = targetDb.collection(spec.name);
    if (!(await collection.exists())) await collection.create();
    for (const index of spec.indexes ?? []) {
      await collection.ensureIndex({ type: 'persistent', fields: index.fields, unique: Boolean(index.unique), sparse: Boolean(index.sparse) });
    }
  }
}
