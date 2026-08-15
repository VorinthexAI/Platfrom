import { describe, expect, test } from 'bun:test';
import { generateDocumentExport } from './exports';

describe('document exports', () => {
  test('exports content unchanged as plain text', async () => {
    const result = await generateDocumentExport({ format: 'txt', content: 'Heading\n\nPlain <text>.' });
    expect(new TextDecoder().decode(result.bytes)).toBe('Heading\n\nPlain <text>.');
    expect(result.extension).toBe('txt');
    expect(result.mimeType).toBe('text/plain; charset=utf-8');
  });

  test('rejects HTML and unknown fields', async () => {
    await expect(generateDocumentExport({ format: 'txt', html: '<p>x</p>' } as never)).rejects.toThrow();
  });
});
