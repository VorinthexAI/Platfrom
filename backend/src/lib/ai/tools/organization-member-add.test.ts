import { expect, test } from 'bun:test';
import { organizationMemberAddTool } from './organization-member-add';
test('organization.member.add definition', () => { expect(organizationMemberAddTool.name).toBe('organization.member.add'); expect(organizationMemberAddTool.inputSchema).toBeDefined(); });
