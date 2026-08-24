import { describe, expect, test } from 'bun:test';
import { compareEmailMessages, latestEmailMessage } from './message-order';

describe('email message ordering', () => {
  test('uses provider identity as the deterministic equal-time tie-breaker', () => {
    const sentAt = '2026-08-23T12:00:00.000Z';
    const lower = { sentAt, providerMessageId: 'message-a' };
    const higher = { sentAt, providerMessageId: 'message-z' };
    expect([higher, lower].sort(compareEmailMessages)).toEqual([lower, higher]);
    expect(latestEmailMessage([lower, higher])).toBe(higher);
  });
});
