import { expect, test } from 'bun:test';
import { organizationMemberSuspendTool } from './organization-member-suspend';
test('organization.member.suspend definition', () => { expect(organizationMemberSuspendTool.name).toBe('organization.member.suspend'); expect(organizationMemberSuspendTool.inputSchema).toBeDefined(); });
