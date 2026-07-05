import type { Page } from './base';
import { getAllAgentsChunked, listAgentsPage } from './agents.node';
import { getAllAuthChallengesChunked, listAuthChallengesPage } from './auth-challenges.node';
import { getAllCapabilitiesChunked, listCapabilitiesPage } from './capabilities.node';
import { getAllEventsChunked, listEventsPage } from './events.node';
import { getAllMembersChunked, listMembersPage } from './members.node';
import { getAllMindCapabilitiesChunked, listMindCapabilitiesPage } from './mind-capabilities.node';
import { getAllMindsChunked, listMindsPage } from './minds.node';
import { getAllOutputAnalyticsChunked, listOutputAnalyticsPage } from './output-analytics.node';
import { getAllOutputRelationsChunked, listOutputRelationsPage } from './output-relations.node';
import { getAllOutputsChunked, listOutputsPage } from './outputs.node';
import { getAllOrchestratorsChunked, listOrchestratorsPage } from './orchestrators.node';
import { getAllPaymentCheckoutsChunked, listPaymentCheckoutsPage } from './payment-checkouts.node';
import { getAllPaymentOrdersChunked, listPaymentOrdersPage } from './payment-orders.node';
import { getAllPlatformsChunked, listPlatformsPage } from './platforms.node';
import { getAllProcessedWebhookEventsChunked, listProcessedWebhookEventsPage } from './processed-webhook-events.node';
import { getAllProductsChunked, listProductsPage } from './products.node';
import { getAllSubscriptionsChunked, listSubscriptionsPage } from './subscriptions.node';
import { getAllSuperAdminsChunked, listSuperAdminsPage } from './super-admins.node';
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
  agents: { listPage: listAgentsPage, getAllChunked: getAllAgentsChunked },
  authChallenges: { listPage: listAuthChallengesPage, getAllChunked: getAllAuthChallengesChunked },
  capabilities: { listPage: listCapabilitiesPage, getAllChunked: getAllCapabilitiesChunked },
  events: { listPage: listEventsPage, getAllChunked: getAllEventsChunked },
  members: { listPage: listMembersPage, getAllChunked: getAllMembersChunked },
  mindCapabilities: { listPage: listMindCapabilitiesPage, getAllChunked: getAllMindCapabilitiesChunked },
  minds: { listPage: listMindsPage, getAllChunked: getAllMindsChunked },
  outputAnalytics: { listPage: listOutputAnalyticsPage, getAllChunked: getAllOutputAnalyticsChunked },
  outputRelations: { listPage: listOutputRelationsPage, getAllChunked: getAllOutputRelationsChunked },
  outputs: { listPage: listOutputsPage, getAllChunked: getAllOutputsChunked },
  orchestrators: { listPage: listOrchestratorsPage, getAllChunked: getAllOrchestratorsChunked },
  paymentCheckouts: { listPage: listPaymentCheckoutsPage, getAllChunked: getAllPaymentCheckoutsChunked },
  paymentOrders: { listPage: listPaymentOrdersPage, getAllChunked: getAllPaymentOrdersChunked },
  platforms: { listPage: listPlatformsPage, getAllChunked: getAllPlatformsChunked },
  processedWebhookEvents: { listPage: listProcessedWebhookEventsPage, getAllChunked: getAllProcessedWebhookEventsChunked },
  products: { listPage: listProductsPage, getAllChunked: getAllProductsChunked },
  subscriptions: { listPage: listSubscriptionsPage, getAllChunked: getAllSubscriptionsChunked },
  superAdmins: { listPage: listSuperAdminsPage, getAllChunked: getAllSuperAdminsChunked },
  userEntitlements: { listPage: listUserEntitlementsPage, getAllChunked: getAllUserEntitlementsChunked },
  users: { listPage: listUsersPage, getAllChunked: getAllUsersChunked },
};

export const NODE_NAMES = Object.keys(NODE_REGISTRY).sort();
