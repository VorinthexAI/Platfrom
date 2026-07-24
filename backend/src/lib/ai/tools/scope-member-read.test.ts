import { expect, test } from 'bun:test';
import { scopeMemberReadTool } from './scope-member-read';
test('scope.member.read definition', () => { expect(scopeMemberReadTool.name).toBe('scope.member.read'); expect(scopeMemberReadTool.inputSchema).toBeDefined(); });
