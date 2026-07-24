import { expect, test } from 'bun:test';
import { scopeMemberAddTool } from './scope-member-add';
test('scope.member.add definition', () => { expect(scopeMemberAddTool.name).toBe('scope.member.add'); expect(scopeMemberAddTool.inputSchema).toBeDefined(); });
