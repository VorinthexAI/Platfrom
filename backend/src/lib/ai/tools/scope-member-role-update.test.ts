import { expect, test } from 'bun:test';
import { scopeMemberRoleUpdateTool } from './scope-member-role-update';
test('scope.member.role.update definition', () => { expect(scopeMemberRoleUpdateTool.name).toBe('scope.member.role.update'); expect(scopeMemberRoleUpdateTool.inputSchema).toBeDefined(); });
