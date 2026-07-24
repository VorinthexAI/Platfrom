import { expect, test } from 'bun:test';
import { scopeListTool } from './scope-list';
test('scope.list definition', () => { expect(scopeListTool.name).toBe('scope.list'); expect(scopeListTool.inputSchema).toBeDefined(); });
