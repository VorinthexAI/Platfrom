import { db, withTransaction } from '@/lib/db/client';

export interface AccountDeletionPlan {
  email: string;
  scopeKeys: string[];
  visitorKeys: string[];
  presenceSessionKeys: string[];
  activeCheckout: boolean;
  recoverableCheckout: boolean;
}

export type AccountDeletionFenceResult =
  | { status: 'fenced'; presenceSessionKeys: string[]; recipient: { email: string } }
  | { status: 'not_found' | 'active_checkout' | 'checkout_recovery_required' };
export type AccountDeletionResult = { status: 'deleted' | 'not_found' | 'active_checkout' };

type Cursor = { next(): Promise<unknown> };
export interface AccountDeletionDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(collections: string[] | { read?: string[]; write: string[] }, operation: (transaction: AccountDeletionDatabase) => Promise<T>) => Promise<T>;

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
  'checkoutHandoffs', 'paymentCheckouts', 'paymentOrders', 'subscriptions', 'storageObjects', 'storageChargingHours',
  'storageChargingMeters', 'storageRetentionStates', 'storageDeletionJobs',
] as const;

const FENCE_COLLECTIONS = {
  read: ['scopes', 'visitors', 'visitorSessions', 'userSessions', 'paymentCheckouts'],
  write: ['users'],
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
  LET activeCheckout = LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && (checkout.status == "open" || (checkout.status == "pending" && checkout.updatedAt >= @pendingCutoff)) LIMIT 1 RETURN 1) > 0
  LET recoverableCheckout = LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout.status == "pending" && checkout.updatedAt < @pendingCutoff LIMIT 1 RETURN 1) > 0
  RETURN { email: user.email, scopeKeys, visitorKeys, presenceSessionKeys, activeCheckout, recoverableCheckout }
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
  ['checkoutHandoffs', 'item.userKey == @userKey'],
  ['paymentCheckouts', 'item.userKey == @userKey'],
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
      return transact(FENCE_COLLECTIONS, async (transaction) => {
        const cursor = await transaction.query(INSPECT_QUERY, { userKey, pendingCutoff });
        const plan = (await cursor.next() as AccountDeletionPlan | null) ?? null;
        if (!plan) return { status: 'not_found' as const };
        if (plan.activeCheckout) return { status: 'active_checkout' as const };
        if (plan.recoverableCheckout) return { status: 'checkout_recovery_required' as const };
        const fenced = await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null UPDATE user WITH { deletionRequestedAt: user.deletionRequestedAt || @requestedAt, updatedAt: @requestedAt } IN users RETURN NEW._key', { userKey, requestedAt });
        if (await fenced.next() !== userKey) throw new Error('Account deletion fence was not persisted.');
        return { status: 'fenced' as const, presenceSessionKeys: plan.presenceSessionKeys, recipient: { email: plan.email } };
      });
    },
    async finalize(userKey) {
      return transact([...ACCOUNT_DELETE_WRITE_COLLECTIONS], async (transaction) => {
        const cursor = await transaction.query(INSPECT_QUERY, { userKey, pendingCutoff: new Date().toISOString() });
        const plan = (await cursor.next() as AccountDeletionPlan | null) ?? null;
        if (!plan) return { status: 'not_found' as const };
        if (plan.activeCheckout || plan.recoverableCheckout) return { status: 'active_checkout' as const };
        const fenceCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user != null && IS_STRING(user.deletionRequestedAt)', { userKey });
        if (await fenceCursor.next() !== true) throw new Error('Account deletion requires a durable deletion fence.');

        const storage = await transaction.query(`LET user = DOCUMENT(users, @userKey)
          RETURN UNIQUE(UNION(
            IS_STRING(user.profileStorageKey) ? [user.profileStorageKey] : [],
            (FOR file IN files FILTER file.userKey == @userKey FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) RETURN key),
            (FOR object IN storageObjects FILTER object.userKey == @userKey && IS_STRING(object.storageKey) RETURN object.storageKey),
            (FOR artifact IN conversationAttachmentArtifacts FILTER artifact.userKey == @userKey && IS_STRING(artifact.stagedStorageKey) RETURN artifact.stagedStorageKey)
          ))`, { userKey });
        const storageKeys = await storage.next() as string[];
        await transaction.query('FOR storageKey IN @storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE {} IN storageDeletionJobs', { storageKeys, now: new Date().toISOString() });

        const ticketCursor = await transaction.query('RETURN (FOR ticket IN tickets FILTER ticket.userKey == @userKey RETURN ticket._key)', { userKey });
        const tagCursor = await transaction.query('RETURN (FOR tag IN tags FILTER tag.userKey == @userKey RETURN tag._key)', { userKey });
        // Keep the installation's spent-grant marker, but remove every link to
        // the deleted user so a new account on this device cannot claim again.
        await transaction.query('FOR claim IN newcomerGrantClaims FILTER claim.userKey == @userKey UPDATE claim WITH { userKey: null } IN newcomerGrantClaims OPTIONS { keepNull: false }', { userKey });
        const values = { userKey, scopeKeys: plan.scopeKeys, visitorKeys: plan.visitorKeys, ticketKeys: await ticketCursor.next(), tagKeys: await tagCursor.next() };
        for (const [collection, predicate] of DELETE_OWNED) {
          const bind: Record<string, unknown> = { '@collection': collection };
          for (const [key, value] of Object.entries(values)) if (predicate.includes(`@${key}`)) bind[key] = value;
          await transaction.query(`FOR item IN @@collection FILTER ${predicate} REMOVE item IN @@collection`, bind);
        }
        const removed = await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null REMOVE user IN users RETURN OLD._key', { userKey });
        if (await removed.next() !== userKey) throw new Error('Account deletion transaction did not remove the user.');
        return { status: 'deleted' as const };
      });
    },
  };
}
