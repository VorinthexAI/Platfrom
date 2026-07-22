import { expect, test } from 'bun:test';
import { organizationMemberListTool } from './organization-member-list';
test('organization.member.list definition', () => { expect(organizationMemberListTool.name).toBe('organization.member.list'); expect(organizationMemberListTool.inputSchema).toBeDefined(); });
