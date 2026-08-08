import { expect, test } from 'bun:test';
import { documentVersionContentTool } from './document-version-content';
test('document-version.archive definition', () => { expect(documentVersionContentTool.name).toBe('document-version.archive'); expect(documentVersionContentTool.inputSchema).toBeDefined(); });
