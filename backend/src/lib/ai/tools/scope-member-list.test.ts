import { expect, test } from 'bun:test';
import { scopeMemberListTool } from './scope-member-list';
test('scope.member.list definition', () => { expect(scopeMemberListTool.name).toBe('scope.member.list'); expect(scopeMemberListTool.inputSchema).toBeDefined(); });
