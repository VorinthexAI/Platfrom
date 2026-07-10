import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';
import { organizationSchema } from './organizations.node';
import { agentSchema } from './agents.node';
import { authChallengeSchema } from './auth-challenges.node';
import { capabilitySchema } from './capabilities.node';
import { eventSchema } from './events.node';
import { intelligenceFragmentSchema } from './intelligence-fragments.node';
import { mindCapabilitySchema } from './mind-capabilities.node';
import { mindSchema } from './minds.node';
import { orchestratorSchema } from './orchestrators.node';
import { outputAnalyticsSchema } from './output-analytics.node';
import { outputRelationSchema } from './output-relations.node';
import { outputSchema } from './outputs.node';
import { paymentCheckoutSchema } from './payment-checkouts.node';
import { paymentOrderSchema } from './payment-orders.node';
import { processedWebhookEventSchema } from './processed-webhook-events.node';
import { productSchema } from './products.node';
import { subscriptionSchema } from './subscriptions.node';
import { teamMemberInviteSchema } from './team-member-invites.node';
import { teamMemberSchema } from './team-members.node';
import { teamSchema } from './teams.node';
import { userEntitlementSchema } from './user-entitlements.node';
import { userSchema } from './users.node';
import { userSessionSchema } from './user-sessions.node';
import { userWaitlistLeaderboardChangeSchema } from './user-waitlist-leaderboard-changes.node';
import { visitorSchema } from './visitors.node';
import { visitorSessionSchema } from './visitor-sessions.node';

const baseOrganization = {
  key: 'org_root',
  name: 'Vorinthex AI',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('organization node schema', () => {
  test('defaults to a non-root organization with empty metadata', () => {
    const organization = organizationSchema.parse(baseOrganization);

    expect(organization.is_root).toBe(false);
    expect(organization.metadata).toEqual({});
    expect(organization.embedding).toEqual([]);
  });

  test('accepts the root flag for Vorinthex AI itself', () => {
    const organization = organizationSchema.parse({
      ...baseOrganization,
      is_root: true,
    });

    expect(organization.is_root).toBe(true);
    expect(organization.name).toBe('Vorinthex AI');
  });

  test('owning nodes link through organizationId', () => {
    const linked = {
      user: userSchema.parse({
        key: 'usr_1',
        organizationId: 'org_root',
        email: 'user@example.com',
        emailHash: 'a'.repeat(64),
        createdAt: baseOrganization.createdAt,
        updatedAt: baseOrganization.updatedAt,
      }),
      visitor: visitorSchema.parse({
        key: 'vis_1',
        organizationId: 'org_root',
        distinctId: 'device-1',
        alias: 'Quiet Comet',
        lastSeenAt: baseOrganization.createdAt,
        createdAt: baseOrganization.createdAt,
        updatedAt: baseOrganization.updatedAt,
      }),
    };

    expect(linked.user.organizationId).toBe('org_root');
    expect(linked.visitor.organizationId).toBe('org_root');
  });

  test('events belong to an organization or an app, never a platform', () => {
    expect(() =>
      eventSchema.parse({
        key: 'evt_1',
        sourceId: 'org_root',
        belongsTo: 'platform',
        slug: 'landing.page_viewed',
        createdAt: baseOrganization.createdAt,
      }),
    ).toThrow();

    const event = eventSchema.parse({
      key: 'evt_1',
      sourceId: 'org_root',
      belongsTo: 'organization',
      slug: 'landing.page_viewed',
      createdAt: baseOrganization.createdAt,
    });
    expect(event.belongsTo).toBe('organization');
  });
});

/** The platform node is gone: no node schema may keep a platform-era field. */
describe('no node field mentions the retired platform', () => {
  const nodeSchemas: Record<string, z.ZodObject<z.ZodRawShape>> = {
    agents: agentSchema,
    authChallenges: authChallengeSchema,
    capabilities: capabilitySchema,
    events: eventSchema,
    intelligenceFragments: intelligenceFragmentSchema,
    mindCapabilities: mindCapabilitySchema,
    minds: mindSchema,
    orchestrators: orchestratorSchema,
    organizations: organizationSchema,
    outputAnalytics: outputAnalyticsSchema,
    outputRelations: outputRelationSchema,
    outputs: outputSchema,
    paymentCheckouts: paymentCheckoutSchema,
    paymentOrders: paymentOrderSchema,
    processedWebhookEvents: processedWebhookEventSchema,
    products: productSchema,
    subscriptions: subscriptionSchema,
    teamMemberInvites: teamMemberInviteSchema,
    teamMembers: teamMemberSchema,
    teams: teamSchema,
    userEntitlements: userEntitlementSchema,
    userSessions: userSessionSchema,
    userWaitlistLeaderboardChanges: userWaitlistLeaderboardChangeSchema,
    users: userSchema,
    visitorSessions: visitorSessionSchema,
    visitors: visitorSchema,
  };

  for (const [name, schema] of Object.entries(nodeSchemas)) {
    test(`${name} has no platform-named fields`, () => {
      const offenders = Object.keys(schema.shape).filter((field) =>
        field.toLowerCase().includes('platform'),
      );
      expect(offenders).toEqual([]);
    });
  }
});
