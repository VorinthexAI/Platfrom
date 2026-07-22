import { expect, test } from 'bun:test';
import { accessScopeEvaluateTool } from './access-scope-evaluate';
test('access.scope.evaluate definition', () => { expect(accessScopeEvaluateTool.name).toBe('access.scope.evaluate'); expect(accessScopeEvaluateTool.inputSchema).toBeDefined(); });
