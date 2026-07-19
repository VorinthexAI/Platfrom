import { describe, expect, test } from 'bun:test';
import { artifactInvalidation, isOrganizationInvalidationSlug, organizationInvalidationSchema, projectOrganizationInvalidation } from './organization-invalidation';

const scopeKey = 'cm00000000000000000000001';
const artifactKey = 'cm00000000000000000000002';

describe('organization invalidation projection', () => {
  test('projects a graph node reference without leaking the event payload', () => {
    const event = projectOrganizationInvalidation({
      scopeId: scopeKey,
      slug: 'artifact.updated',
      data: { nodeType: 'artifacts', nodeKey: artifactKey, reason: 'private', outputTokens: 800 },
    });

    expect(event).toEqual({
      slug: 'artifact.updated',
      scopeKey,
      resource: { type: 'artifacts', key: artifactKey },
    });
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('outputTokens');
  });

  test('uses a run as the thin subject for tool lifecycle events', () => {
    expect(projectOrganizationInvalidation({
      scopeId: scopeKey,
      slug: 'tool.completed',
      data: { runKey: artifactKey, toolName: 'Secret tool name', status: 'completed' },
    })).toEqual({
      slug: 'tool.completed',
      scopeKey,
      resource: { type: 'agentRuns', key: artifactKey },
    });
  });

  test('projects organization-provider events to their provider-link identity', () => {
    expect(projectOrganizationInvalidation({
      scopeId: scopeKey,
      slug: 'organization.provider.usage',
      data: { nodeType: 'organizationProviders', nodeKey: artifactKey, inputTokens: 800 },
    })).toEqual({
      slug: 'organization.provider.usage',
      scopeKey,
      resource: { type: 'organizationProviders', key: artifactKey },
    });
  });

  test('allows collection-level invalidation when no resource id exists', () => {
    expect(projectOrganizationInvalidation({ scopeId: scopeKey, slug: 'scope.list', data: {} })).toEqual({
      slug: 'scope.list',
      scopeKey,
      resource: null,
    });
  });

  test('produces the same strict envelope for dependency invalidations', () => {
    expect(organizationInvalidationSchema.parse(artifactInvalidation(scopeKey, artifactKey))).toEqual({
      slug: 'artifact.invalidated',
      scopeKey,
      resource: { type: 'artifacts', key: artifactKey },
    });
  });

  test('streams runtime activity and mutations but excludes analytics and reads', () => {
    expect(isOrganizationInvalidationSlug('tool.called')).toBe(true);
    expect(isOrganizationInvalidationSlug('scope.agent.add')).toBe(true);
    expect(isOrganizationInvalidationSlug('organization.update')).toBe(true);
    expect(isOrganizationInvalidationSlug('organization.provider.usage')).toBe(true);
    expect(isOrganizationInvalidationSlug('scope.agent.list')).toBe(false);
    expect(isOrganizationInvalidationSlug('landing.page_viewed')).toBe(false);
  });
});
