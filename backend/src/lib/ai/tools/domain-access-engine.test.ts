import { describe, expect, test } from 'bun:test';
import { explainAgentDecision, explainOrganizationDecision, explainScopeDecision } from './domain-access-engine';

const organization = { key: 'org', name: 'Acme', slug: 'acme', description: null, is_root: false, isActive: false, createdAt: 'now', updatedAt: 'now', metadata: {} };

describe('shared access explanations', () => {
  test('renders the exact structured organization denial instead of re-evaluating policy', () => {
    const decision = { allowed: false, reason: 'ORGANIZATION_ARCHIVED' as const, effectiveRole: 'owner' as const, organization, membership: null };
    expect(explainOrganizationDecision(decision)).toContain('arkiverad');
  });

  test('separates scope and scope-agent lifecycle denials', () => {
    const organizationDecision = { allowed: true, reason: 'ALLOWED' as const, effectiveRole: 'viewer' as const, organization: { ...organization, isActive: true }, membership: null };
    const scopeDecision = { allowed: false, reason: 'SCOPE_ARCHIVED', effectiveRole: null, accessSources: [], organizationDecision, scope: { key: 'scope', organizationKey: 'org', slug: 'sales', name: 'Sales', deletedAt: 'now' } };
    expect(explainScopeDecision(scopeDecision)).toContain('Sales');
    const agentDecision = { allowed: false, reason: 'SCOPE_AGENT_ARCHIVED' as const, effectiveScopeRole: 'viewer' as const, agentAccessSources: [], scopeDecision, scopeAgent: null, agent: null };
    expect(explainAgentDecision(agentDecision)).toContain('Relationen');
  });
});
