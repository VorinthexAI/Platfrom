import { describe, expect, test } from 'bun:test';
import { createEventIdentifier, currentEventIdentifier, eventIdentifierSchema, runWithEventIdentifier } from './event-identifier';

describe('event identifier context', () => {
  test('binds an identifier across asynchronous work without leaking it', async () => {
    const identifier = 'a'.repeat(128);
    expect(currentEventIdentifier()).toBeNull();
    await runWithEventIdentifier(identifier, async () => {
      await Promise.resolve();
      expect(currentEventIdentifier()).toBe(identifier);
    });
    expect(currentEventIdentifier()).toBeNull();
  });

  test('creates lowercase hex identifiers from 64 random bytes', () => {
    const first = createEventIdentifier();
    const second = createEventIdentifier();
    expect(eventIdentifierSchema.parse(first)).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{128}$/);
    expect(second).not.toBe(first);
  });
});
