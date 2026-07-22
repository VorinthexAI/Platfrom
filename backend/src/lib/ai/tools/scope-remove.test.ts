import { expect, test } from 'bun:test';
import { scopeRemoveTool } from './scope-remove';
test('scope.remove definition', () => { expect(scopeRemoveTool.name).toBe('scope.remove'); expect(scopeRemoveTool.inputSchema).toBeDefined(); });
