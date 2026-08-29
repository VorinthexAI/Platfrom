import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { organizationSchema } from './organizations.node';
import { authChallengeSchema } from './auth-challenges.node';
import { orchestratorSchema } from './orchestrators.node';
import { processedWebhookEventSchema } from './processed-webhook-events.node';
import { userOrganizationSchema } from './user-organization.node';
import { userSchema } from './users.node';
import { userSessionSchema } from './user-sessions.node';
import { visitorSchema } from './visitors.node';
import { visitorSessionSchema } from './visitor-sessions.node';
import { voiceSchema } from './voices.node';

const baseOrganization = {
  key: 'org_root',
  name: 'Vorinthex AI',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('organization node schema', () => {
  test('defaults to a non-root organization with empty metadata', () => {
    const organization = organizationSchema.parse({ ...baseOrganization, ownerId: 'legacy-owner' });

    expect(organization.is_root).toBe(false);
    expect(organization.mfa_enabled).toBe(false);
    expect(organization.metadata).toEqual({});
    expect(organization.embedding).toEqual([]);
    expect('ownerId' in organization).toBe(false);
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

});

/** The platform and team nodes are gone: no node schema may keep a
 * platform- or team-era field. */
describe('no node field mentions the retired platform or team nodes', () => {
  const nodeSchemas: Record<string, z.ZodTypeAny> = {
    authChallenges: authChallengeSchema,
    orchestrators: orchestratorSchema,
    organizations: organizationSchema,
    processedWebhookEvents: processedWebhookEventSchema,
    userOrganizations: userOrganizationSchema,
    userSessions: userSessionSchema,
    users: userSchema,
    visitorSessions: visitorSessionSchema,
    visitors: visitorSchema,
    voices: voiceSchema,
  };

  function getObjectShape(schema: z.ZodTypeAny): z.ZodRawShape {
    let current = schema;

    while (current instanceof z.ZodEffects) {
      current = current.innerType();
    }

    if (!(current instanceof z.ZodObject)) {
      throw new Error('Expected node schema to resolve to a Zod object');
    }

    return current.shape;
  }

  for (const [name, schema] of Object.entries(nodeSchemas)) {
    test(`${name} has no platform- or team-named fields`, () => {
      const offenders = Object.keys(getObjectShape(schema)).filter((field) => {
        const lower = field.toLowerCase();
        return lower.includes('platform') || lower.includes('team');
      });
      expect(offenders).toEqual([]);
    });
  }
});
