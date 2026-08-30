import { expect, test } from 'bun:test';

test('production runtime plans complete chapters before batched prose generation', async () => {
  const source = await Bun.file(new URL('./runtime.ts', import.meta.url)).text();
  expect(source).not.toContain('generateChapterContent');
  expect(source).not.toContain('Continuity-edit');
  expect(source).toContain("required: ['title', 'subtitle', 'description', 'outcome', 'summary', 'coverVisualPlan', 'chapters']");
  expect(source).toContain("required: ['title', 'description', 'promptGuidance', 'objective'");
  expect(source).toContain('if (suffix.some((chapter) => !chapter.promptGuidance))');
  expect(source).not.toContain("purpose: 'artwork-compliance'");
  expect(source).not.toContain('inspectArtwork');
  expect(source).not.toContain('generation or compliance failed');
  expect(source).not.toContain('for (const chapter of suffix)');
  expect(source).not.toContain('boundedMap(suffix, 3');
  expect(source).toContain("{ signal, timeoutMs: 90_000 }");
  expect(source).toContain("name: 'book_chapter_drafts'");
  expect(source).toContain('Write all requested audiobook chapters as one coherent nonfiction manuscript');
  expect(source).not.toContain('boundedProse');
  expect(source).toContain("await stage('audio', 'narrating')");
  expect(source).toContain('boundedMap(missingAudio, BOOK_SPEECH_CONCURRENCY, narrate)');
  expect(source).not.toContain('Math.max(1, suffix.length)');
  expect(source).toContain('content, draftInputHash: target.draftInputHash, finalizationInputHash: undefined, audioInputHash: undefined, audioStorageKey: undefined');
  expect(source).toContain("size: '1024x1536'");
  expect(source).toContain("resize(864, 1_536, { fit: 'cover', position: 'centre' })");
  expect(source).toContain('await Promise.all([dumpArchiveCopies(exportDetail, context), dumpGalleryCopies(exportDetail, context)])');
});
