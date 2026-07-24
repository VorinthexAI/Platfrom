import { expect, test } from 'bun:test';
import { organizationMemberActivateTool } from './organization-member-activate';
test('organization.member.activate definition', () => { expect(organizationMemberActivateTool.name).toBe('organization.member.activate'); expect(organizationMemberActivateTool.inputSchema).toBeDefined(); });
