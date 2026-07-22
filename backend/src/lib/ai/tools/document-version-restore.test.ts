import { expect, test } from 'bun:test';
import { documentVersionRestoreTool } from './document-version-restore';
test('document-version.restore definition', () => { expect(documentVersionRestoreTool.name).toBe('document-version.restore'); expect(documentVersionRestoreTool.inputSchema).toBeDefined(); });
