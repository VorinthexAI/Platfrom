import { expect, test } from 'bun:test';
import { scopeMemberSuspendTool } from './scope-member-suspend';
test('scope.member.suspend definition', () => { expect(scopeMemberSuspendTool.name).toBe('scope.member.suspend'); expect(scopeMemberSuspendTool.inputSchema).toBeDefined(); });
