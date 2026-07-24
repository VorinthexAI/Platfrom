import { expect, test } from 'bun:test';
import { organizationMemberRoleUpdateTool } from './organization-member-role-update';
test('organization.member.role.update definition', () => { expect(organizationMemberRoleUpdateTool.name).toBe('organization.member.role.update'); expect(organizationMemberRoleUpdateTool.inputSchema).toBeDefined(); });
