import { expect, test } from 'bun:test';
import { scopeReadTool } from './scope-read';
test('scope.read definition', () => { expect(scopeReadTool.name).toBe('scope.read'); expect(scopeReadTool.inputSchema).toBeDefined(); });
