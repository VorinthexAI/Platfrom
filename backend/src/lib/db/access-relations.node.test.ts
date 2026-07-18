import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { scopeAgentSchema } from './scope-agents.node';
import { agentMemberSchema } from './agent-members.node';

const now = '2026-07-18T00:00:00.000Z';

describe('scope agent and agent member schemas', () => {
  test('model lifecycle, threshold, provenance, and source without relation data on agents', () => {
    const organizationKey = newId(); const scopeKey = newId(); const agentKey = newId();
    const relation = scopeAgentSchema.parse({ key: newId(), organizationKey, scopeKey, agentKey, position: 1, minimumAccessRole: 'moderator', createdAt: now, updatedAt: now });
    expect(relation).toMatchObject({ status: 'active', minimumAccessRole: 'moderator' });
    const grant = agentMemberSchema.parse({ key: newId(), organizationKey, scopeKey, agentKey, scopeAgentKey: relation.key, userOrganizationKey: newId(), source: 'inherited', createdAt: now });
    expect(grant).toMatchObject({ source: 'inherited', scopeAgentKey: relation.key });
    expect(() => scopeAgentSchema.parse({ ...relation, minimumAccessRole: 'member' })).toThrow();
    expect(() => agentMemberSchema.parse({ ...grant, source: 'role' })).toThrow();
  });
});
