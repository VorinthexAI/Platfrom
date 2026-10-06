import { db, withTransaction } from '@/lib/db/client';
import { logAccountDeletion, serializeDeletionError } from './debug-log';

export interface AccountDeletionPlan {
  email: string;
  scopeKeys: string[];
  visitorKeys: string[];
  presenceSessionKeys: string[];
}

export type AccountDeletionFenceResult =
  | { status: 'fenced'; presenceSessionKeys: string[]; recipient: { email: string } }
  | { status: 'not_found' };
export type AccountDeletionResult = { status: 'deleted' | 'not_found' };

type Cursor = { next(): Promise<unknown> };
export interface AccountDeletionDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(collections: string[] | { read?: string[]; write: string[]; exclusive?: string[] }, operation: (transaction: AccountDeletionDatabase) => Promise<T>) => Promise<T>;

export interface AccountDeletionRepository {
  fence(userKey: string, pendingCutoff: string, requestedAt: string): Promise<AccountDeletionFenceResult>;
  finalize(userKey: string): Promise<AccountDeletionResult>;
}

// Only collections that exist in the current user -> scopes -> folders -> files
// model belong here. Global product, webhook, and migration ledgers are retained.
export const ACCOUNT_DELETE_WRITE_COLLECTIONS = [
  'users', 'scopes', 'folders', 'files', 'authSessions', 'authChallenges', 'userSessions', 'visitors', 'visitorSessions',
  'userSearches', 'contentIdempotency', 'conversations', 'conversationMessages', 'conversationAttachmentArtifacts', 'conversationArchiveStates',
  'tickets', 'ticketVotes', 'userNotifications', 'events', 'tags', 'tagAssignments', 'pushSubscriptions', 'pushDeliveries',
  'sparkTransactions', 'billingExecutions', 'newcomerGrantClaims', 'referralCodes', 'referralAttributions', 'referralRewards',
  'paymentOrders', 'subscriptions', 'storageObjects', 'storageChargingHours',
  'storageChargingMeters', 'storageRetentionStates', 'storageDeletionJobs',
] as const;

const FENCE_COLLECTIONS = {
  read: ['scopes', 'visitors', 'visitorSessions', 'userSessions'],
  write: ['users'],
  exclusive: [] as string[],
};

const INSPECT_QUERY = `
  LET user = DOCUMENT(users, @userKey)
  FILTER user != null
  LET scopeKeys = (FOR scope IN scopes FILTER scope.userKey == @userKey RETURN scope._key)
  LET visitorKeys = (FOR visitor IN visitors FILTER visitor.userId == @userKey || visitor.emailHash == user.emailHash RETURN visitor._key)
  LET presenceSessionKeys = UNIQUE(UNION(
    (FOR item IN userSessions FILTER item.userId == @userKey RETURN item.sessionKey),
    (FOR item IN visitorSessions FILTER item.visitorId IN visitorKeys RETURN item.sessionKey)
  ))
  RETURN { email: user.email, scopeKeys, visitorKeys, presenceSessionKeys }
`;

// Predicates are fixed by the repository, never supplied by a caller. Keep each
// collection's removal in the same exclusive transaction as the user removal.
const DELETE_OWNED = [
  ['ticketVotes', 'item.userKey == @userKey || item.ticketKey IN @ticketKeys || item.scopeKey IN @scopeKeys'],
  ['tickets', 'item.userKey == @userKey'],
  ['tagAssignments', 'item.scopeKey IN @scopeKeys || item.tagKey IN @tagKeys'],
  ['tags', 'item.userKey == @userKey'],
  ['pushDeliveries', 'item.userKey == @userKey'],
  ['pushSubscriptions', 'item.userKey == @userKey'],
  ['userNotifications', 'item.userKey == @userKey'],
  ['conversationMessages', 'item.userKey == @userKey'],
  ['conversationAttachmentArtifacts', 'item.userKey == @userKey'],
  ['conversationArchiveStates', 'item.userKey == @userKey'],
  ['conversations', 'item.userKey == @userKey'],
  ['files', 'item.userKey == @userKey'],
  ['folders', 'item.userKey == @userKey'],
  ['scopes', 'item.userKey == @userKey'],
  ['storageObjects', 'item.userKey == @userKey'],
  ['storageChargingHours', 'item.userKey == @userKey'],
  ['storageChargingMeters', 'item.userKey == @userKey'],
  ['storageRetentionStates', 'item.userKey == @userKey'],
  ['contentIdempotency', 'item.actorKey == @userKey || item.userKey == @userKey'],
  ['userSearches', 'item.userKey == @userKey'],
  ['events', 'item.userId == @userKey || item.scopeKey IN @scopeKeys'],
  ['billingExecutions', 'item.userKey == @userKey'],
  ['sparkTransactions', 'item.userKey == @userKey'],
  ['referralRewards', 'item.referrerUserKey == @userKey || item.referredUserKey == @userKey'],
  ['referralAttributions', 'item.referrerUserKey == @userKey || item.referredUserKey == @userKey'],
  ['referralCodes', 'item.ownerUserKey == @userKey'],
  ['paymentOrders', 'item.userKey == @userKey'],
  ['subscriptions', 'item.userKey == @userKey'],
  ['authSessions', 'item.userId == @userKey'],
  ['authChallenges', 'item.identityKey == @userKey || item.userId == @userKey'],
  ['userSessions', 'item.userId == @userKey'],
  ['visitorSessions', 'item.visitorId IN @visitorKeys'],
  ['visitors', 'item._key IN @visitorKeys'],
] as const;

export function createAccountDeletionRepository(
  database: AccountDeletionDatabase = db as unknown as AccountDeletionDatabase,
  transact: TransactionRunner = (collections, operation) => withTransaction(collections, (transaction) => operation(transaction as unknown as AccountDeletionDatabase)),
): AccountDeletionRepository {
  return {
    async fence(userKey, pendingCutoff, requestedAt) {
      logAccountDeletion('fence.start', { userKey, pendingCutoff, requestedAt });
      try {
        return await transact(FENCE_COLLECTIONS, async (transaction) => {
          const cursor = await transaction.query(INSPECT_QUERY, { userKey, pendingCutoff });
          const plan = (await cursor.next() as AccountDeletionPlan | null) ?? null;
          if (!plan) {
            logAccountDeletion('fence.not-found', { userKey });
            return { status: 'not_found' as const };
          }
          logAccountDeletion('fence.plan', { userKey, scopeCount: plan.scopeKeys.length, visitorCount: plan.visitorKeys.length, presenceSessionCount: plan.presenceSessionKeys.length, hasEmail: Boolean(plan.email) });
          const fenced = await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null UPDATE user WITH { deletionRequestedAt: user.deletionRequestedAt || @requestedAt, updatedAt: @requestedAt } IN users RETURN NEW._key', { userKey, requestedAt });
          if (await fenced.next() !== userKey) throw new Error('Account deletion fence was not persisted.');
          logAccountDeletion('fence.persisted', { userKey });
          return { status: 'fenced' as const, presenceSessionKeys: plan.presenceSessionKeys, recipient: { email: plan.email } };
        });
      } catch (error) {
        logAccountDeletion('fence.error', { userKey, error: serializeDeletionError(error) });
        throw error;
      }
    },
    async finalize(userKey) {
      logAccountDeletion('finalize.start', { userKey });
      try {
        return await transact({ write: [...ACCOUNT_DELETE_WRITE_COLLECTIONS], exclusive: [] }, async (transaction) => {
          const cursor = await transaction.query(INSPECT_QUERY, { userKey, pendingCutoff: new Date().toISOString() });
          const plan = (await cursor.next() as AccountDeletionPlan | null) ?? null;
          if (!plan) {
            logAccountDeletion('finalize.not-found', { userKey });
            return { status: 'not_found' as const };
          }
          logAccountDeletion('finalize.plan', { userKey, scopeCount: plan.scopeKeys.length, visitorCount: plan.visitorKeys.length, presenceSessionCount: plan.presenceSessionKeys.length });
          const fenceCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user != null && IS_STRING(user.deletionRequestedAt)', { userKey });
          if (await fenceCursor.next() !== true) throw new Error('Account deletion requires a durable deletion fence.');
          logAccountDeletion('finalize.fence-ok', { userKey });

          const storage = await transaction.query(`LET user = DOCUMENT(users, @userKey)
            RETURN UNIQUE(UNION(
              IS_STRING(user.profileStorageKey) ? [user.profileStorageKey] : [],
              (FOR file IN files FILTER file.userKey == @userKey FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) RETURN key),
              (FOR object IN storageObjects FILTER object.userKey == @userKey && IS_STRING(object.storageKey) RETURN object.storageKey),
              (FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey && IS_STRING(artifact.stagedStorageKey) RETURN artifact.stagedStorageKey)
            ))`, { userKey });
          const storageKeys = await storage.next() as string[];
          logAccountDeletion('finalize.storage-keys', { userKey, storageKeyCount: Array.isArray(storageKeys) ? storageKeys.length : 0 });
          await transaction.query('FOR storageKey IN @storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE {} IN storageDeletionJobs', { storageKeys, now: new Date().toISOString() });

          const ticketCursor = await transaction.query('RETURN (FOR ticket IN tickets FILTER ticket.userKey == @userKey RETURN ticket._key)', { userKey });
          const tagCursor = await transaction.query('RETURN (FOR tag IN tags FILTER tag.userKey == @userKey RETURN tag._key)', { userKey });
          await transaction.query('FOR claim IN newcomerGrantClaims FILTER claim.userKey == @userKey UPDATE claim WITH { userKey: null } IN newcomerGrantClaims OPTIONS { keepNull: false }', { userKey });
          const values = { userKey, scopeKeys: plan.scopeKeys, visitorKeys: plan.visitorKeys, ticketKeys: await ticketCursor.next(), tagKeys: await tagCursor.next() };
          logAccountDeletion('finalize.owned-keys', { userKey, ticketCount: Array.isArray(values.ticketKeys) ? values.ticketKeys.length : 0, tagCount: Array.isArray(values.tagKeys) ? values.tagKeys.length : 0 });
          for (const [collection, predicate] of DELETE_OWNED) {
            logAccountDeletion('finalize.collection', { userKey, collection });
            const bind: Record<string, unknown> = { '@collection': collection };
            for (const [key, value] of Object.entries(values)) if (predicate.includes(`@${key}`)) bind[key] = value;
            await transaction.query(`FOR item IN @@collection FILTER ${predicate} REMOVE item IN @@collection`, bind);
          }
          const removed = await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null REMOVE user IN users RETURN OLD._key', { userKey });
          if (await removed.next() !== userKey) throw new Error('Account deletion transaction did not remove the user.');
          logAccountDeletion('finalize.user-removed', { userKey });
          return { status: 'deleted' as const };
        });
      } catch (error) {
        logAccountDeletion('finalize.error', { userKey, error: serializeDeletionError(error) });
        throw error;
      }
    },
  };
}
