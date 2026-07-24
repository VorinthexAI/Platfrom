import { expect, test } from 'bun:test';
import { documentShareArchiveTool } from './document-share-archive';
test('document-share.archive definition', () => { expect(documentShareArchiveTool.name).toBe('document-share.archive'); expect(documentShareArchiveTool.inputSchema).toBeDefined(); });
