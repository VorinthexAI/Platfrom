import type { Page } from './base';
import { getAllActionsChunked, listActionsPage, upsertActionByKey } from './actions.node';
import { getAllProvidersChunked, listProvidersPage, upsertProviderByKey } from './providers.node';
import { getAllModelsChunked, listModelsPage, upsertModelByKey } from './models.node';
import { getAllModelActionsChunked, listModelActionsPage, upsertModelActionByKey } from './model-actions.node';
import { getAllModelProvidersChunked, listModelProvidersPage, upsertModelProviderByKey } from './model-providers.node';
import { getAllAgentsChunked, listAgentsPage, upsertAgentByKey } from './agents.node';
import { getAllSkillsChunked, listSkillsPage, upsertSkillByKey } from './skills.node';
import { getAllAgentSkillsChunked, listAgentSkillsPage, upsertAgentSkillByKey } from './agent-skills.node';
import { getAllVisitorSessionsChunked, listVisitorSessionsPage, upsertVisitorSessionByKey } from './visitor-sessions.node';
import { getAllUserSessionsChunked, listUserSessionsPage, upsertUserSessionByKey } from './user-sessions.node';
import { getAllAuthChallengesChunked, listAuthChallengesPage, upsertAuthChallengeByKey } from './auth-challenges.node';
import { getAllCapabilitiesChunked, listCapabilitiesPage, upsertCapabilityByKey } from './capabilities.node';
import { getAllEventsChunked, listEventsPage, upsertEventByKey } from './events.node';
import { getAllIntelligenceFragmentsChunked, listIntelligenceFragmentsPage, upsertIntelligenceFragmentByKey } from './intelligence-fragments.node';
import { getAllMindCapabilitiesChunked, listMindCapabilitiesPage, upsertMindCapabilityByKey } from './mind-capabilities.node';
import { getAllMindsChunked, listMindsPage, upsertMindByKey } from './minds.node';
import { getAllOrchestratorsChunked, listOrchestratorsPage, upsertOrchestratorByKey } from './orchestrators.node';
import { getAllUserOrganizationsChunked, listUserOrganizationsPage, upsertUserOrganizationByKey } from './user-organization.node';
import { getAllOrganizationsChunked, listOrganizationsPage, upsertOrganization } from './organizations.node';
import { getAllPaymentCheckoutsChunked, listPaymentCheckoutsPage, upsertPaymentCheckoutByKey } from './payment-checkouts.node';
import { getAllPaymentOrdersChunked, listPaymentOrdersPage, upsertPaymentOrderByKey } from './payment-orders.node';
import { getAllProcessedWebhookEventsChunked, listProcessedWebhookEventsPage, upsertProcessedWebhookEventByKey } from './processed-webhook-events.node';
import { getAllProductsChunked, listProductsPage, upsertProduct } from './products.node';
import { getAllSubscriptionsChunked, listSubscriptionsPage, upsertSubscriptionByKey } from './subscriptions.node';
import { getAllUserEntitlementsChunked, listUserEntitlementsPage, upsertUserEntitlementByKey } from './user-entitlements.node';
import { getAllUsersChunked, listUsersPage, upsertUserByKey } from './users.node';
import { getAllVisitorsChunked, listVisitorsPage, upsertVisitorByKey } from './visitors.node';
import { getAllVoicesChunked, listVoicesPage, upsertVoiceByKey } from './voices.node';
import { getAllScopeAgentsChunked, listScopeAgentsPage, upsertScopeAgentByKey } from './scope-agents.node';
import { getAllAgentMembersChunked, listAgentMembersPage, upsertAgentMemberByKey } from './agent-members.node';
import { getAllChannelsChunked, listChannelsPage, upsertChannelByKey } from './channels.node';
import { getAllChannelParticipantsChunked, listChannelParticipantsPage, upsertChannelParticipantByKey } from './channel-participants.node';
import { getAllThreadsChunked, listThreadsPage, upsertThreadByKey } from './threads.node';
import { getAllMessagesChunked, listMessagesPage, upsertMessageByKey } from './messages.node';
import { getAllMessageMentionsChunked, listMessageMentionsPage, upsertMessageMentionByKey } from './message-mentions.node';
import { getAllMessageReactionsChunked, listMessageReactionsPage, upsertMessageReactionByKey } from './message-reactions.node';
import { getAllFoldersChunked, listFoldersPage, upsertFolderByKey } from './folders.node';
import { getAllDocumentsChunked, listDocumentsPage, upsertDocumentByKey } from './documents.node';
import { getAllDocumentVersionsChunked, listDocumentVersionsPage, upsertDocumentVersionByKey } from './document-versions.node';
import { getAllDocumentSharesChunked, listDocumentSharesPage, upsertDocumentShareByKey } from './document-shares.node';

export interface NodeAccessors {
  /** One resumable page — for stateless HTTP pagination (GET /api/v1/nodes). */
  listPage: (after?: string, limit?: number) => Promise<Page<unknown>>;
  /** The entire collection, streamed in chunks — for in-process bulk tools/scripts. */
  getAllChunked: (chunkSize?: number) => AsyncGenerator<unknown[], void, void>;
  /**
   * Insert-or-replace by key — idempotent seed/upsert entry point (e.g.
   * db.seeds.secrets.json). Typed `never` because each node's concrete
   * upsert takes its own schema shape (strict function variance forbids
   * widening those to a common Record parameter); untyped registry callers
   * pass their payload `as never` and the node's zod schema validates it.
   */
  upsertByKey: (input: never) => Promise<unknown>;
}

/**
 * Every node, keyed by its collection name. This is the single source of
 * truth for both the unified GET /api/v1/nodes endpoint and any script that
 * needs to work across "all nodes" (e.g. scripts/nodes.ts) — add a node here
 * once and it shows up in both automatically.
 */
export const NODE_REGISTRY: Record<string, NodeAccessors> = {
  actions: { listPage: listActionsPage, getAllChunked: getAllActionsChunked, upsertByKey: upsertActionByKey },
  agents: { listPage: listAgentsPage, getAllChunked: getAllAgentsChunked, upsertByKey: upsertAgentByKey },
  agentSkills: { listPage: listAgentSkillsPage, getAllChunked: getAllAgentSkillsChunked, upsertByKey: upsertAgentSkillByKey },
  agentMembers: { listPage: listAgentMembersPage, getAllChunked: getAllAgentMembersChunked, upsertByKey: upsertAgentMemberByKey },
  authChallenges: { listPage: listAuthChallengesPage, getAllChunked: getAllAuthChallengesChunked, upsertByKey: upsertAuthChallengeByKey },
  capabilities: { listPage: listCapabilitiesPage, getAllChunked: getAllCapabilitiesChunked, upsertByKey: upsertCapabilityByKey },
  channels: { listPage: listChannelsPage, getAllChunked: getAllChannelsChunked, upsertByKey: upsertChannelByKey },
  channelParticipants: { listPage: listChannelParticipantsPage, getAllChunked: getAllChannelParticipantsChunked, upsertByKey: upsertChannelParticipantByKey },
  threads: { listPage: listThreadsPage, getAllChunked: getAllThreadsChunked, upsertByKey: upsertThreadByKey },
  messages: { listPage: listMessagesPage, getAllChunked: getAllMessagesChunked, upsertByKey: upsertMessageByKey },
  messageMentions: { listPage: listMessageMentionsPage, getAllChunked: getAllMessageMentionsChunked, upsertByKey: upsertMessageMentionByKey },
  messageReactions: { listPage: listMessageReactionsPage, getAllChunked: getAllMessageReactionsChunked, upsertByKey: upsertMessageReactionByKey },
  folders: { listPage: listFoldersPage, getAllChunked: getAllFoldersChunked, upsertByKey: upsertFolderByKey },
  documents: { listPage: listDocumentsPage, getAllChunked: getAllDocumentsChunked, upsertByKey: upsertDocumentByKey },
  documentVersions: { listPage: listDocumentVersionsPage, getAllChunked: getAllDocumentVersionsChunked, upsertByKey: upsertDocumentVersionByKey },
  documentShares: { listPage: listDocumentSharesPage, getAllChunked: getAllDocumentSharesChunked, upsertByKey: upsertDocumentShareByKey },
  events: { listPage: listEventsPage, getAllChunked: getAllEventsChunked, upsertByKey: upsertEventByKey },
  intelligenceFragments: { listPage: listIntelligenceFragmentsPage, getAllChunked: getAllIntelligenceFragmentsChunked, upsertByKey: upsertIntelligenceFragmentByKey },
  mindCapabilities: { listPage: listMindCapabilitiesPage, getAllChunked: getAllMindCapabilitiesChunked, upsertByKey: upsertMindCapabilityByKey },
  minds: { listPage: listMindsPage, getAllChunked: getAllMindsChunked, upsertByKey: upsertMindByKey },
  modelActions: { listPage: listModelActionsPage, getAllChunked: getAllModelActionsChunked, upsertByKey: upsertModelActionByKey },
  modelProviders: { listPage: listModelProvidersPage, getAllChunked: getAllModelProvidersChunked, upsertByKey: upsertModelProviderByKey },
  models: { listPage: listModelsPage, getAllChunked: getAllModelsChunked, upsertByKey: upsertModelByKey },
  orchestrators: { listPage: listOrchestratorsPage, getAllChunked: getAllOrchestratorsChunked, upsertByKey: upsertOrchestratorByKey },
  organizations: { listPage: listOrganizationsPage, getAllChunked: getAllOrganizationsChunked, upsertByKey: upsertOrganization },
  paymentCheckouts: { listPage: listPaymentCheckoutsPage, getAllChunked: getAllPaymentCheckoutsChunked, upsertByKey: upsertPaymentCheckoutByKey },
  paymentOrders: { listPage: listPaymentOrdersPage, getAllChunked: getAllPaymentOrdersChunked, upsertByKey: upsertPaymentOrderByKey },
  processedWebhookEvents: { listPage: listProcessedWebhookEventsPage, getAllChunked: getAllProcessedWebhookEventsChunked, upsertByKey: upsertProcessedWebhookEventByKey },
  providers: { listPage: listProvidersPage, getAllChunked: getAllProvidersChunked, upsertByKey: upsertProviderByKey },
  products: { listPage: listProductsPage, getAllChunked: getAllProductsChunked, upsertByKey: upsertProduct },
  subscriptions: { listPage: listSubscriptionsPage, getAllChunked: getAllSubscriptionsChunked, upsertByKey: upsertSubscriptionByKey },
  skills: { listPage: listSkillsPage, getAllChunked: getAllSkillsChunked, upsertByKey: upsertSkillByKey },
  scopeAgents: { listPage: listScopeAgentsPage, getAllChunked: getAllScopeAgentsChunked, upsertByKey: upsertScopeAgentByKey },
  userEntitlements: { listPage: listUserEntitlementsPage, getAllChunked: getAllUserEntitlementsChunked, upsertByKey: upsertUserEntitlementByKey },
  userSessions: { listPage: listUserSessionsPage, getAllChunked: getAllUserSessionsChunked, upsertByKey: upsertUserSessionByKey },
  userOrganizations: { listPage: listUserOrganizationsPage, getAllChunked: getAllUserOrganizationsChunked, upsertByKey: upsertUserOrganizationByKey },
  users: { listPage: listUsersPage, getAllChunked: getAllUsersChunked, upsertByKey: upsertUserByKey },
  visitorSessions: { listPage: listVisitorSessionsPage, getAllChunked: getAllVisitorSessionsChunked, upsertByKey: upsertVisitorSessionByKey },
  visitors: { listPage: listVisitorsPage, getAllChunked: getAllVisitorsChunked, upsertByKey: upsertVisitorByKey },
  voices: { listPage: listVoicesPage, getAllChunked: getAllVoicesChunked, upsertByKey: upsertVoiceByKey },
};

export const NODE_NAMES = Object.keys(NODE_REGISTRY).sort();

/** Registers a node accessor at startup so generic consumers discover new nodes automatically. */
export function registerNode(name: string, accessors: NodeAccessors): void {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid node name: ${name}`);
  if (NODE_REGISTRY[name]) throw new Error(`Node already registered: ${name}`);
  NODE_REGISTRY[name] = accessors;
  NODE_NAMES.splice(0, NODE_NAMES.length, ...Object.keys(NODE_REGISTRY).sort());
}
