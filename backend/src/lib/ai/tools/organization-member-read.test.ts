import { expect, test } from 'bun:test';
import { organizationMemberReadTool } from './organization-member-read';
test('organization.member.read definition', () => { expect(organizationMemberReadTool.name).toBe('organization.member.read'); expect(organizationMemberReadTool.inputSchema).toBeDefined(); });
