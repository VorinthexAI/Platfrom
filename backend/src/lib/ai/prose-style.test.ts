import { expect, test } from 'bun:test';
import { USER_VISIBLE_AI_PROSE_POLICY } from './prose-style';

const proseSurfaces = await Promise.all([
  Bun.file(new URL('./agents/index.ts', import.meta.url)).text(),
  Bun.file(new URL('./personal-assistant/runtime.ts', import.meta.url)).text(),
  Bun.file(new URL('../../api/communication.ts', import.meta.url)).text(),
  Bun.file(new URL('./actions/document-text-generation.ts', import.meta.url)).text(),
  Bun.file(new URL('../email-inbox/service.ts', import.meta.url)).text(),
  Bun.file(new URL('../books/runtime.ts', import.meta.url)).text(),
  Bun.file(new URL('../travel/service.ts', import.meta.url)).text(),
  Bun.file(new URL('../gallery/operations.ts', import.meta.url)).text(),
  Bun.file(new URL('../onboarding-sandbox/service.ts', import.meta.url)).text(),
]);

test('defines one scoped style policy for newly authored AI prose', () => {
  expect(USER_VISIBLE_AI_PROSE_POLICY).toContain('only as Vorinthex AI');
  expect(USER_VISIBLE_AI_PROSE_POLICY).toContain('Do not use hyphen or dash characters');
  expect(USER_VISIBLE_AI_PROSE_POLICY).toContain('Preserve literal source text');
});

test('uses the shared prose policy across user facing generation surfaces', () => {
  for (const source of proseSurfaces) expect(source).toContain('USER_VISIBLE_AI_PROSE_POLICY');
});
