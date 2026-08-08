import { expect, test } from 'bun:test';
import { scopeContentTool } from './scope-content';
test('scope.archive definition', () => { expect(scopeContentTool.name).toBe('scope.archive'); expect(scopeContentTool.inputSchema).toBeDefined(); });
