import { describe, expect, test } from 'bun:test';
import { fileInputSchema, fileOutputSchema, MAX_FILE_ACTION_BYTES, MAX_FILE_ACTION_TEXT_CHARACTERS } from './file';

describe('file action contracts', () => {
  test('accepts only strict bounded document and scan inputs', () => {
    expect(fileInputSchema.parse({ operation: 'document', storageKey: 'content/report.pdf', filename: 'report.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]) }).operation).toBe('document');
    expect(fileInputSchema.parse({ operation: 'scan', storageKey: 'content/page.png', mimeType: 'image/png', bytes: new Uint8Array([1]) }).operation).toBe('scan');
    expect(() => fileInputSchema.parse({ operation: 'scan', storageKey: 'content/page.png', mimeType: 'image/png', bytes: new Uint8Array([1]), extra: true })).toThrow();
    expect(() => fileInputSchema.parse({ operation: 'document', storageKey: 'content/report.pdf', filename: 'report.pdf', mimeType: 'text/plain', bytes: new Uint8Array([1]) })).toThrow();
    expect(() => fileInputSchema.parse({ operation: 'scan', storageKey: 'content/page.png', mimeType: 'image/png', bytes: new Uint8Array(MAX_FILE_ACTION_BYTES + 1) })).toThrow();
  });

  test('accepts only strict bounded OCR output and confidence metadata', () => {
    expect(fileOutputSchema.parse({ text: 'Exact text\n' })).toEqual({ text: 'Exact text\n' });
    expect(fileOutputSchema.parse({ text: '', metadata: { averageConfidence: 99 } })).toEqual({ text: '', metadata: { averageConfidence: 99 } });
    expect(() => fileOutputSchema.parse({ text: ' ', extra: true })).toThrow();
    expect(() => fileOutputSchema.parse({ text: 'x'.repeat(MAX_FILE_ACTION_TEXT_CHARACTERS + 1) })).toThrow();
  });
});
