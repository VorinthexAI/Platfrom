import type { Page } from './base';
import { getAllAuthChallengesChunked, listAuthChallengesPage } from './auth-challenges.node';
import { getAllEventsChunked, listEventsPage } from './events.node';
import { getAllOutputAnalyticsChunked, listOutputAnalyticsPage } from './output-analytics.node';
import { getAllOutputRelationsChunked, listOutputRelationsPage } from './output-relations.node';
import { getAllOutputsChunked, listOutputsPage } from './outputs.node';
import { getAllPaymentCheckoutsChunked, listPaymentCheckoutsPage } from './payment-checkouts.node';
import { getAllPaymentOrdersChunked, listPaymentOrdersPage } from './payment-orders.node';
import { getAllPlatformsChunked, listPlatformsPage } from './platforms.node';
import { getAllProcessedWebhookEventsChunked, listProcessedWebhookEventsPage } from './processed-webhook-events.node';
import { getAllProductsChunked, listProductsPage } from './products.node';
import { getAllSubscriptionsChunked, listSubscriptionsPage } from './subscriptions.node';
import { getAllUserEntitlementsChunked, listUserEntitlementsPage } from './user-entitlements.node';
import { getAllUsersChunked, listUsersPage } from './users.node';

export interface NodeAccessors {
  /** One resumable page — for stateless HTTP pagination (GET /api/v1/nodes). */
  listPage: (after?: string, limit?: number) => Promise<Page<unknown>>;
  /** The entire collection, streamed in chunks — for in-process bulk tools/scripts. */
  getAllChunked: (chunkSize?: number) => AsyncGenerator<unknown[], void, void>;
}

/**
 * Every node, keyed by its collection name. This is the single source of
 * truth for both the unified GET /api/v1/nodes endpoint and any script that
 * needs to work across "all nodes" (e.g. scripts/nodes.ts) — add a node here
 * once and it shows up in both automatically.
 */
export const NODE_REGISTRY: Record<string, NodeAccessors> = {
  authChallenges: { listPage: listAuthChallengesPage, getAllChunked: getAllAuthChallengesChunked },
  events: { listPage: listEventsPage, getAllChunked: getAllEventsChunked },
  outputAnalytics: { listPage: listOutputAnalyticsPage, getAllChunked: getAllOutputAnalyticsChunked },
  outputRelations: { listPage: listOutputRelationsPage, getAllChunked: getAllOutputRelationsChunked },
  outputs: { listPage: listOutputsPage, getAllChunked: getAllOutputsChunked },
  paymentCheckouts: { listPage: listPaymentCheckoutsPage, getAllChunked: getAllPaymentCheckoutsChunked },
  paymentOrders: { listPage: listPaymentOrdersPage, getAllChunked: getAllPaymentOrdersChunked },
  platforms: { listPage: listPlatformsPage, getAllChunked: getAllPlatformsChunked },
  processedWebhookEvents: { listPage: listProcessedWebhookEventsPage, getAllChunked: getAllProcessedWebhookEventsChunked },
  products: { listPage: listProductsPage, getAllChunked: getAllProductsChunked },
  subscriptions: { listPage: listSubscriptionsPage, getAllChunked: getAllSubscriptionsChunked },
  userEntitlements: { listPage: listUserEntitlementsPage, getAllChunked: getAllUserEntitlementsChunked },
  users: { listPage: listUsersPage, getAllChunked: getAllUsersChunked },
};

export const NODE_NAMES = Object.keys(NODE_REGISTRY).sort();
