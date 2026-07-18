import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { TOOL_IDS } from '@/lib/ai/tools';
import { DOMAIN_ACTION_SLUGS, domainToolInputSchemas, domainToolJsonSchemas, organizationActionAllowed, scopeActionAllowed } from '@/lib/ai/domain-tools';
import { ORGANIZATION_STEWARD_SKILL, ORGANIZATION_STEWARD_TOOL_SLUGS, validateOrganizationStewardBindings } from '.';

describe('Organization Steward profile', () => {
  test('grants the complete local organization administration surface', () => {
    expect(ORGANIZATION_STEWARD_TOOL_SLUGS).toEqual(DOMAIN_ACTION_SLUGS);
    expect(ORGANIZATION_STEWARD_TOOL_SLUGS).toHaveLength(50);
    expect(new Set(ORGANIZATION_STEWARD_TOOL_SLUGS).size).toBe(ORGANIZATION_STEWARD_TOOL_SLUGS.length);
    for (const slug of ORGANIZATION_STEWARD_TOOL_SLUGS) {
      expect(ACTION_SLUGS).toContain(slug);
      expect(TOOL_IDS).toContain(slug);
      expect(domainToolInputSchemas[slug]).toBeDefined();
      expect(domainToolJsonSchemas[slug]).toBeDefined();
    }
  });

  test('contains no model-routed capability and explicitly preserves human authority', () => {
    expect(ORGANIZATION_STEWARD_TOOL_SLUGS.some((slug) => slug.startsWith('core.'))).toBe(false);
    expect(ORGANIZATION_STEWARD_SKILL.definition).toContain("initiating human's effective organization and scope permissions");
    expect(ORGANIZATION_STEWARD_SKILL.definition).toContain('Never treat the agent');
  });

  test('rejects incomplete generated agents and accepts the exact canonical profile', () => {
    const scopeKey = 'scope';
    const tools = ORGANIZATION_STEWARD_TOOL_SLUGS.map((slug, index) => ({ key: `tool-${index}`, slug, enabled: true, scopeKey: null }));
    const skillOperations = [{ operation: 'create' as const, ...ORGANIZATION_STEWARD_SKILL }];
    expect(validateOrganizationStewardBindings({ scopeKey, tools, skills: [], attachedToolKeys: tools.map(({ key }) => key), skillOperations })).toBeNull();
    expect(validateOrganizationStewardBindings({ scopeKey, tools, skills: [], attachedToolKeys: tools.slice(1).map(({ key }) => key), skillOperations })).toContain('missing tools');
    expect(validateOrganizationStewardBindings({ scopeKey, tools, skills: [], attachedToolKeys: tools.map(({ key }) => key), skillOperations: [{ ...skillOperations[0]!, definition: 'Unsafe generic admin.' }] })).toContain('canonical Organization Steward skill');
  });

  test('lets an admin administer while retaining owner-only destructive boundaries', () => {
    for (const action of ['organization.update', 'organization.provider.enable', 'organization.member.add', 'organization.member.remove']) expect(organizationActionAllowed('admin', action)).toBe(true);
    for (const action of ['organization.archive', 'organization.restore']) expect(organizationActionAllowed('admin', action)).toBe(false);
    for (const action of ['scope.create', 'scope.archive', 'scope.agent.add', 'scope.member.role.update']) expect(scopeActionAllowed('admin', action)).toBe(true);
    expect(scopeActionAllowed('admin', 'scope.remove')).toBe(false);
    expect(scopeActionAllowed('viewer', 'scope.member.add')).toBe(false);
  });
});
