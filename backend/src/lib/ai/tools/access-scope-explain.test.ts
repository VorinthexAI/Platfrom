import { expect, test } from 'bun:test';
import { accessScopeExplainTool } from './access-scope-explain';
test('access.scope.explain definition', () => { expect(accessScopeExplainTool.name).toBe('access.scope.explain'); expect(accessScopeExplainTool.inputSchema).toBeDefined(); });
