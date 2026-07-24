import { expect, test } from 'bun:test';
import { scopeUpdateTool } from './scope-update';
test('scope.update definition', () => { expect(scopeUpdateTool.name).toBe('scope.update'); expect(scopeUpdateTool.inputSchema).toBeDefined(); });
