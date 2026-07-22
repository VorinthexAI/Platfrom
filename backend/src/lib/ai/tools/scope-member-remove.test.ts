import { expect, test } from 'bun:test';
import { scopeMemberRemoveTool } from './scope-member-remove';
test('scope.member.remove definition', () => { expect(scopeMemberRemoveTool.name).toBe('scope.member.remove'); expect(scopeMemberRemoveTool.inputSchema).toBeDefined(); });
