import { expect, test } from 'bun:test';
import { scopeRestoreTool } from './scope-restore';
test('scope.restore definition', () => { expect(scopeRestoreTool.name).toBe('scope.restore'); expect(scopeRestoreTool.inputSchema).toBeDefined(); });
