import { expect, test } from 'bun:test';
import { scopeMoveTool } from './scope-move';
test('scope.move definition', () => { expect(scopeMoveTool.name).toBe('scope.move'); expect(scopeMoveTool.inputSchema).toBeDefined(); });
