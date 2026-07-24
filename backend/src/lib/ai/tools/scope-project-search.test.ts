import { expect, test } from 'bun:test';
import { scopeProjectSearchTool } from './scope-project-search';
test('scope.project.search definition', () => { expect(scopeProjectSearchTool.name).toBe('scope.project.search'); expect(scopeProjectSearchTool.inputSchema).toBeDefined(); });
