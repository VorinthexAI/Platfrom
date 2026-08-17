import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { cursorPage, decodeCursor, encodeCursor } from './cursor-pagination';

describe('cursor pagination', () => {
  test('encodes opaque validated cursors and probes one extra item', () => {
    const schema = z.object({ version: z.literal(1), key: z.string() }).strict();
    const encoded = encodeCursor({ version: 1, key: 'second' });
    expect(decodeCursor(encoded, schema)).toEqual({ version: 1, key: 'second' });
    expect(cursorPage([{ key: 'first' }, { key: 'second' }, { key: 'third' }], 2, ({ key }) => encodeCursor({ version: 1, key }))).toEqual({
      items: [{ key: 'first' }, { key: 'second' }],
      nextCursor: encoded,
    });
    expect(() => decodeCursor('not-a-cursor', schema)).toThrow('Cursor is invalid');
  });
});
