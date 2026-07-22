import { expect, test } from 'bun:test';
import { scopeArchiveTool } from './scope-archive';
test('scope.archive definition', () => { expect(scopeArchiveTool.name).toBe('scope.archive'); expect(scopeArchiveTool.inputSchema).toBeDefined(); });
