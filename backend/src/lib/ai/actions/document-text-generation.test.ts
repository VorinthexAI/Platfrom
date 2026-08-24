import { expect, test } from 'bun:test';
import { generateDocumentSummary, generateDocumentTranslation } from './document-text-generation';

test('accepts a concise one-section structured summary', async () => {
  const summary = await generateDocumentSummary({ documents: [{ name: 'Short email', content: 'Please approve this.' }], style: 'brief' }, async () => JSON.stringify({ sections: [{ heading: 'Request', body: 'Approval is requested.' }] }));
  expect(summary).toBe('Request\nApproval is requested.');
});

test('translates large documents in bounded ordered chunks', async () => {
  const calls: Array<{ text: string; maxTokens: number }> = [];
  let active = 0;
  let peak = 0;
  const translated = await generateDocumentTranslation({ content: 'a'.repeat(40_000), targetLanguage: 'Swedish', preserveFormatting: true }, async (input) => {
    calls.push({ text: input.text, maxTokens: input.maxTokens });
    active += 1;
    peak = Math.max(peak, active);
    await Bun.sleep(1);
    active -= 1;
    return `translated-${input.text.length}`;
  });

  expect(calls.length).toBeGreaterThan(1);
  expect(calls.every(({ text, maxTokens }) => text.length <= 16_000 && maxTokens >= 1_024 && maxTokens <= 5_000)).toBe(true);
  expect(peak).toBeLessThanOrEqual(4);
  expect(translated).toBe(calls.map(({ text }) => `translated-${text.length}`).join('\n\n'));
});

test('rejects documents without translatable text before calling a model', async () => {
  let called = false;
  await expect(generateDocumentTranslation({ content: '  \n ', targetLanguage: 'Swedish' }, async () => {
    called = true;
    return 'unused';
  })).rejects.toThrow('The document contains no text to translate.');
  expect(called).toBe(false);
});
