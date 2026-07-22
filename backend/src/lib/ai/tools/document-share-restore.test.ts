import { expect, test } from 'bun:test';
import { documentShareRestoreTool } from './document-share-restore';
test('document-share.restore definition', () => { expect(documentShareRestoreTool.name).toBe('document-share.restore'); expect(documentShareRestoreTool.inputSchema).toBeDefined(); });
