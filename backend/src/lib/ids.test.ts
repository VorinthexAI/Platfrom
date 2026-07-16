import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { newId } from './ids';

describe('domain CUID helper', () => {
  test('creates values accepted by the persisted key contract', () => {
    const first = newId();
    const second = newId();
    expect(z.string().cuid().parse(first)).toBe(first);
    expect(second).not.toBe(first);
  });
});
