import { expect, test } from 'bun:test';
import { scopeCreateTool } from './scope-create';
test('scope.create definition', () => { expect(scopeCreateTool.name).toBe('scope.create'); expect(scopeCreateTool.inputSchema).toBeDefined(); });
