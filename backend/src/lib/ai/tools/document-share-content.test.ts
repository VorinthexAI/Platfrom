import { expect, test } from 'bun:test';
import { documentShareContentTool } from './document-share-content';
test('document-share.archive definition', () => { expect(documentShareContentTool.name).toBe('document-share.archive'); expect(documentShareContentTool.inputSchema).toBeDefined(); });
