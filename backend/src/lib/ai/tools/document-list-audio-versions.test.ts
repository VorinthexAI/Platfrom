import { expect, test } from 'bun:test';
import { documentListAudioVersionsToolDefinition } from './document-list-audio-versions';

test('document.list-audio-versions definition has a name and input schema', () => {
  expect(documentListAudioVersionsToolDefinition.name).toBe('document.list-audio-versions');
  expect(documentListAudioVersionsToolDefinition.inputSchema).toBeDefined();
});
