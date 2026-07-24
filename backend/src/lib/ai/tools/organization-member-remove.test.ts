import { expect, test } from 'bun:test';
import { organizationMemberRemoveTool } from './organization-member-remove';
test('organization.member.remove definition', () => { expect(organizationMemberRemoveTool.name).toBe('organization.member.remove'); expect(organizationMemberRemoveTool.inputSchema).toBeDefined(); });
