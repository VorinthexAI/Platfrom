import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { threadSchema } from './threads.node';

const base = { key: newId(), scopeKey: newId(), channelKey: newId(), rootMessageKey: newId(), status: 'open', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' };

describe('thread schema', () => {
  test('requires a name of at most 50 characters', () => {
    expect(threadSchema.parse({ ...base, title: 'Launch planning' }).title).toBe('Launch planning');
    expect(() => threadSchema.parse(base)).toThrow();
    expect(() => threadSchema.parse({ ...base, title: 'x'.repeat(51) })).toThrow();
  });
});
