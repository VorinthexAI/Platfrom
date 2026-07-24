import { expect, test } from 'bun:test';
import { documentVersionArchiveTool } from './document-version-archive';
test('document-version.archive definition', () => { expect(documentVersionArchiveTool.name).toBe('document-version.archive'); expect(documentVersionArchiveTool.inputSchema).toBeDefined(); });
