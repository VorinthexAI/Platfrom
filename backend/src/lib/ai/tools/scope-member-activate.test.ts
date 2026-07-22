import { expect, test } from 'bun:test';
import { scopeMemberActivateTool } from './scope-member-activate';
test('scope.member.activate definition', () => { expect(scopeMemberActivateTool.name).toBe('scope.member.activate'); expect(scopeMemberActivateTool.inputSchema).toBeDefined(); });
