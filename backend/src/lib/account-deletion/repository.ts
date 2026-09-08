import { db, withTransaction } from '@/lib/db/client';
import { createScopeRepository, SCOPE_REMOVAL_WRITE_COLLECTIONS } from '@/lib/ai/scopes/repository';

export interface AccountDeletionPlan {
  userKey: string;
  teamKeys: string[];
  scopeKeys: string[];
  presenceSessionKeys: string[];
  blocked: boolean;
  activeCheckout: boolean;
  recoverableCheckout: boolean;
}

export type AccountDeletionFenceResult =
  | { status: 'fenced'; presenceSessionKeys: string[] }
  | { status: 'not_found' | 'shared_access' | 'active_checkout' | 'checkout_recovery_required' };
export type AccountDeletionResult =
  | { status: 'deleted' }
  | { status: 'not_found' | 'shared_access' | 'active_checkout' };

type Cursor = { next(): Promise<unknown> };
export interface AccountDeletionDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(collections: string[] | { read?: string[]; write: string[] }, operation: (transaction: AccountDeletionDatabase) => Promise<T>) => Promise<T>;

export interface AccountDeletionRepository {
  fence(userKey: string, pendingCutoff: string, requestedAt: string): Promise<AccountDeletionFenceResult>;
  finalize(userKey: string): Promise<AccountDeletionResult>;
}

const ACCOUNT_DELETE_WRITE_COLLECTIONS = [
  'users', 'teams', 'userTeams', 'scopes', 'scopeMembers', 'authSessions', 'authChallenges', 'userSessions',
  'visitors', 'visitorSessions',
  'userMentions', 'userReactions', 'userHiddens', 'userGenerations', 'userSearches', 'contentSearchQueries', 'contentIdempotency',
  'conversations', 'conversationMessages', 'ticketVotes', 'tickets', 'events', 'tags', 'tagAssignments',
  'pushSubscriptions', 'appNotifications', 'appNotificationRecipients', 'pushDeliveries',
  'sparkTransactions', 'billingExecutions', 'referralCodes', 'referralAttributions', 'referralRewards',
  'checkoutHandoffs', 'paymentCheckouts', 'paymentOrders', 'subscriptions', 'bookRefundIntents',
  'storageObjects', 'storageChargingHours', 'storageChargingMeters', 'storageRetentionStates', 'galleryUploads', 'storageDeletionJobs',
] as const;

const DELETE_WRITE_COLLECTIONS = [...new Set([...ACCOUNT_DELETE_WRITE_COLLECTIONS, ...SCOPE_REMOVAL_WRITE_COLLECTIONS])];

const INSPECT_QUERY = `
  LET user = DOCUMENT(users, @userKey)
  FILTER user != null
  LET memberships = (FOR membership IN userTeams FILTER membership.userId == @userKey RETURN membership)
  LET personalTeams = (FOR team IN teams FILTER team.personalOwnerUserId == @userKey RETURN team)
  LET teamKeys = UNIQUE(personalTeams[*]._key)
  LET scopeKeys = (FOR scope IN scopes FILTER scope.teamKey IN teamKeys RETURN scope._key)
  LET visitorKeys = (FOR visitor IN visitors FILTER visitor.userId == @userKey || visitor.emailHash == user.emailHash RETURN visitor._key)
  LET presenceSessionKeys = UNIQUE(UNION(
    (FOR item IN userSessions FILTER item.userId == @userKey RETURN item.sessionKey),
    (FOR item IN visitorSessions FILTER item.visitorId IN visitorKeys RETURN item.sessionKey)
  ))
  LET foreignActiveMembership = LENGTH(FOR membership IN memberships FILTER membership.status == "active" && membership.teamKey NOT IN teamKeys LIMIT 1 RETURN 1) > 0
  LET otherTeamMember = LENGTH(FOR membership IN userTeams FILTER membership.teamKey IN teamKeys && membership.userId != @userKey && membership.status == "active" LIMIT 1 RETURN 1) > 0
  LET otherScopeMember = LENGTH(
    FOR member IN scopeMembers
      FILTER member.scopeKey IN scopeKeys && member.status == "active"
      LET membership = DOCUMENT(userTeams, member.userTeamKey)
      FILTER membership != null && membership.status == "active" && membership.userId != @userKey
      LIMIT 1 RETURN 1
  ) > 0
  LET activeCheckout = LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && (checkout.status == "open" || (checkout.status == "pending" && checkout.updatedAt >= @pendingCutoff)) LIMIT 1 RETURN 1) > 0
  LET recoverableCheckout = LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout.status == "pending" && checkout.updatedAt < @pendingCutoff LIMIT 1 RETURN 1) > 0
  RETURN { userKey: user._key, teamKeys, scopeKeys, presenceSessionKeys, blocked: foreignActiveMembership || otherTeamMember || otherScopeMember, activeCheckout, recoverableCheckout }
`;

const FENCE_COLLECTIONS = {
  read: ['teams', 'userTeams', 'scopes', 'scopeMembers', 'visitors', 'visitorSessions', 'paymentCheckouts'],
  write: ['users', 'userSessions'],
};

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
        if (plan.blocked) return { status: 'shared_access' as const };
        if (plan.activeCheckout) return { status: 'active_checkout' as const };
        if (plan.recoverableCheckout) return { status: 'checkout_recovery_required' as const };
        const fenced = await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null UPDATE user WITH { deletionRequestedAt: user.deletionRequestedAt || @requestedAt, updatedAt: @requestedAt } IN users RETURN NEW._key', { userKey, requestedAt });
        if (await fenced.next() !== userKey) throw new Error('Account deletion fence was not persisted.');
        return { status: 'fenced' as const, presenceSessionKeys: plan.presenceSessionKeys };
      });
    },
    async finalize(userKey) {
      return transact(DELETE_WRITE_COLLECTIONS, async (transaction) => {
        const planCursor = await transaction.query(INSPECT_QUERY, { userKey, pendingCutoff: new Date().toISOString() });
        const plan = (await planCursor.next() as AccountDeletionPlan | null) ?? null;
        if (!plan) return { status: 'not_found' as const };
        if (plan.blocked) return { status: 'shared_access' as const };
        if (plan.activeCheckout || plan.recoverableCheckout) return { status: 'active_checkout' as const };
        const fenceCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user != null && IS_STRING(user.deletionRequestedAt)', { userKey });
        if (await fenceCursor.next() !== true) throw new Error('Account deletion requires a durable deletion fence.');

        const scopeRepository = createScopeRepository(transaction as never, async () => []);
        for (const scopeKey of plan.scopeKeys) await scopeRepository.removeScope(scopeKey, userKey);

        const ticketPlanCursor = await transaction.query(`
          LET authoredTicketKeys = (FOR item IN tickets FILTER item.userKey == @userKey RETURN item._key)
          LET votedTicketKeys = UNIQUE(FOR item IN ticketVotes FILTER item.userKey == @userKey RETURN item.ticketKey)
          RETURN { authoredTicketKeys, votedTicketKeys }
        `, { userKey });
        const ticketPlan = await ticketPlanCursor.next() as { authoredTicketKeys: string[]; votedTicketKeys: string[] } | null;
        const authoredTicketKeys = ticketPlan?.authoredTicketKeys ?? [];
        const retainedVotedTicketKeys = (ticketPlan?.votedTicketKeys ?? []).filter((key) => !authoredTicketKeys.includes(key));
        await transaction.query('FOR item IN ticketVotes FILTER item.userKey == @userKey || item.ticketKey IN @authoredTicketKeys REMOVE item IN ticketVotes', { userKey, authoredTicketKeys });
        await transaction.query(`
          FOR item IN tickets
            FILTER item._key IN @ticketKeys && item.type == "feedback"
            LET counts = FIRST(FOR vote IN ticketVotes FILTER vote.ticketKey == item._key COLLECT AGGREGATE upvotes = SUM(vote.vote == "up" ? 1 : 0), downvotes = SUM(vote.vote == "down" ? 1 : 0) RETURN { upvotes, downvotes })
            UPDATE item WITH counts IN tickets
        `, { ticketKeys: retainedVotedTicketKeys });

        const cursor = await transaction.query(`
           LET user = DOCUMENT(users, @userKey)
           FILTER user != null
           LET memberships = (FOR membership IN userTeams FILTER membership.userId == @userKey RETURN membership)
           LET ownedTeamMemberships = (FOR membership IN userTeams FILTER membership.teamKey IN @teamKeys RETURN membership)
           LET teamMembershipKeys = UNIQUE(UNION(memberships[*]._key, ownedTeamMemberships[*]._key))
           LET visitorKeys = (FOR visitor IN visitors FILTER visitor.userId == @userKey || visitor.emailHash == user.emailHash RETURN visitor._key)
           LET presenceSessionKeys = UNIQUE(UNION(
             (FOR item IN userSessions FILTER item.userId == @userKey RETURN item.sessionKey),
             (FOR item IN visitorSessions FILTER item.visitorId IN visitorKeys RETURN item.sessionKey)
           ))
          LET storageKeys = UNIQUE(UNION(
            IS_STRING(user.profileStorageKey) ? [user.profileStorageKey] : [],
            (FOR upload IN galleryUploads FILTER upload.actorKey IN teamMembershipKeys && IS_STRING(upload.storageKey) RETURN upload.storageKey),
            (FOR object IN storageObjects FILTER object.userKey == @userKey && IS_STRING(object.storageKey) RETURN object.storageKey)
          ))
          LET queuedStorage = (FOR storageKey IN storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE {} IN storageDeletionJobs RETURN 1)
          LET cleanupStorageObjects = (FOR item IN storageObjects FILTER item.userKey == @userKey REMOVE item IN storageObjects RETURN 1)
          LET cleanupStorageHours = (FOR item IN storageChargingHours FILTER item.userKey == @userKey REMOVE item IN storageChargingHours RETURN 1)
          LET cleanupStorageMeters = (FOR item IN storageChargingMeters FILTER item.userKey == @userKey REMOVE item IN storageChargingMeters RETURN 1)
          LET cleanupStorageRetention = (FOR item IN storageRetentionStates FILTER item.userKey == @userKey REMOVE item IN storageRetentionStates RETURN 1)
          LET cleanupGalleryUploads = (FOR item IN galleryUploads FILTER item.actorKey IN teamMembershipKeys REMOVE item IN galleryUploads RETURN 1)
          LET cleanupAuthSessions = (FOR item IN authSessions FILTER item.userId == @userKey REMOVE item IN authSessions RETURN 1)
          LET cleanupAuthChallenges = (FOR item IN authChallenges FILTER item.identityKey == @userKey || item.userId == @userKey REMOVE item IN authChallenges RETURN 1)
           LET cleanupPresenceSessions = (FOR item IN userSessions FILTER item.userId == @userKey REMOVE item IN userSessions RETURN 1)
           LET cleanupVisitorSessions = (FOR item IN visitorSessions FILTER item.visitorId IN visitorKeys REMOVE item IN visitorSessions RETURN 1)
           LET cleanupVisitors = (FOR item IN visitors FILTER item._key IN visitorKeys REMOVE item IN visitors RETURN 1)
          LET cleanupMentions = (FOR item IN userMentions FILTER item.userKey == @userKey REMOVE item IN userMentions RETURN 1)
          LET cleanupReactions = (FOR item IN userReactions FILTER item.userKey == @userKey REMOVE item IN userReactions RETURN 1)
          LET cleanupHiddens = (FOR item IN userHiddens FILTER item.userKey == @userKey REMOVE item IN userHiddens RETURN 1)
          LET cleanupGenerations = (FOR item IN userGenerations FILTER item.userKey == @userKey REMOVE item IN userGenerations RETURN 1)
          LET cleanupSearches = (FOR item IN userSearches FILTER item.userKey == @userKey REMOVE item IN userSearches RETURN 1)
          LET cleanupSearchCache = (FOR item IN contentSearchQueries FILTER item.actorKey == @userKey REMOVE item IN contentSearchQueries RETURN 1)
          LET cleanupIdempotency = (FOR item IN contentIdempotency FILTER item.actorKey == @userKey REMOVE item IN contentIdempotency RETURN 1)
          LET cleanupConversationMessages = (FOR item IN conversationMessages FILTER item.userKey == @userKey REMOVE item IN conversationMessages RETURN 1)
          LET cleanupConversations = (FOR item IN conversations FILTER item.userKey == @userKey REMOVE item IN conversations RETURN 1)
           LET cleanupTickets = (FOR item IN tickets FILTER item.userKey == @userKey REMOVE item IN tickets RETURN 1)
          LET cleanupEvents = (FOR item IN events FILTER item.userId == @userKey REMOVE item IN events RETURN 1)
           LET notificationKeys = (FOR item IN appNotifications FILTER item.actorUserKey == @userKey RETURN item._key)
           LET cleanupPushDeliveries = (FOR item IN pushDeliveries FILTER item.userKey == @userKey || item.notificationKey IN notificationKeys REMOVE item IN pushDeliveries RETURN 1)
           LET cleanupNotificationRecipients = (FOR item IN appNotificationRecipients FILTER item.userKey == @userKey || item.notificationKey IN notificationKeys REMOVE item IN appNotificationRecipients RETURN 1)
           LET cleanupNotifications = (FOR item IN appNotifications FILTER item._key IN notificationKeys REMOVE item IN appNotifications RETURN 1)
          LET cleanupPushSubscriptions = (FOR item IN pushSubscriptions FILTER item.userKey == @userKey REMOVE item IN pushSubscriptions RETURN 1)
          LET tagKeys = (FOR item IN tags FILTER item.userKey == @userKey RETURN item._key)
          LET cleanupTagAssignments = (FOR item IN tagAssignments FILTER item.tagKey IN tagKeys REMOVE item IN tagAssignments RETURN 1)
          LET cleanupTags = (FOR item IN tags FILTER item.userKey == @userKey REMOVE item IN tags RETURN 1)
          LET cleanupBillingExecutions = (FOR item IN billingExecutions FILTER item.userKey == @userKey REMOVE item IN billingExecutions RETURN 1)
          LET cleanupSparkTransactions = (FOR item IN sparkTransactions FILTER item.userKey == @userKey REMOVE item IN sparkTransactions RETURN 1)
          LET cleanupReferralRewards = (FOR item IN referralRewards FILTER item.referrerUserKey == @userKey || item.referredUserKey == @userKey REMOVE item IN referralRewards RETURN 1)
          LET cleanupReferralAttributions = (FOR item IN referralAttributions FILTER item.referrerUserKey == @userKey || item.referredUserKey == @userKey REMOVE item IN referralAttributions RETURN 1)
          LET cleanupReferralCodes = (FOR item IN referralCodes FILTER item.ownerUserKey == @userKey REMOVE item IN referralCodes RETURN 1)
          LET cleanupCheckoutHandoffs = (FOR item IN checkoutHandoffs FILTER item.userKey == @userKey REMOVE item IN checkoutHandoffs RETURN 1)
          LET cleanupPaymentCheckouts = (FOR item IN paymentCheckouts FILTER item.userKey == @userKey REMOVE item IN paymentCheckouts RETURN 1)
          LET cleanupPaymentOrders = (FOR item IN paymentOrders FILTER item.userKey == @userKey REMOVE item IN paymentOrders RETURN 1)
          LET cleanupSubscriptions = (FOR item IN subscriptions FILTER item.userKey == @userKey REMOVE item IN subscriptions RETURN 1)
          LET cleanupBookRefunds = (FOR item IN bookRefundIntents FILTER item.userKey == @userKey REMOVE item IN bookRefundIntents RETURN 1)
          LET cleanupScopeMembers = (FOR item IN scopeMembers FILTER item.userTeamKey IN teamMembershipKeys REMOVE item IN scopeMembers RETURN 1)
           LET cleanupMemberships = (FOR item IN userTeams FILTER item._key IN teamMembershipKeys REMOVE item IN userTeams RETURN 1)
          LET cleanupTeams = (FOR item IN teams FILTER item._key IN @teamKeys REMOVE item IN teams RETURN 1)
           REMOVE user IN users
           RETURN presenceSessionKeys
        `, { userKey, teamKeys: plan.teamKeys, now: new Date().toISOString() });
        const presenceSessionKeys = await cursor.next();
        if (!Array.isArray(presenceSessionKeys)) throw new Error('Account deletion transaction did not remove the user.');
        return { status: 'deleted' as const };
      });
    },
  };
}
