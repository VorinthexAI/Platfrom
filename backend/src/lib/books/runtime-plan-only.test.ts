import { expect, test } from 'bun:test';

test('production runtime has no summary-only or serial continuity generation path', async () => {
  const source = await Bun.file(new URL('./runtime.ts', import.meta.url)).text();
  expect(source).not.toContain('generateChapterContent');
  expect(source).not.toContain('Continuity-edit');
  expect(source).toContain('Write one concise summary and prompt guidance for every requested chapter in one batch.');
  expect(source).toContain('await boundedMap(chapters.slice(suffixStart), 3');
  expect(source).toContain('content, draftInputHash, finalizationInputHash: undefined, audioInputHash: undefined, audioStorageKey: undefined');
  expect(source).not.toContain('imageStorageKey: undefined');
  expect(source).toContain("size: '1024x1536'");
  expect(source).toContain("resize(864, 1_536, { fit: 'cover', position: 'centre' })");
});
