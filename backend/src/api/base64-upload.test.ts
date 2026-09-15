import { expect, test } from 'bun:test';
import { isCanonicalUploadBase64 } from './base64-upload';

test('validates large payloads with every legal padding length', () => {
  for (const length of [1, 2, 3, 4 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024 - 1]) expect(isCanonicalUploadBase64(Buffer.alloc(length, 1).toString('base64'))).toBe(true);
});

test('rejects invalid alphabets, embedded or excess padding, and nonzero padding bits', () => {
  for (const invalid of ['', 'abc', 'a===', '====', 'YW J', 'YW\nJ', 'AA=A', 'AA-_', 'AB==', 'AAB=', 'YWJj=']) expect(isCanonicalUploadBase64(invalid)).toBe(false);
});
