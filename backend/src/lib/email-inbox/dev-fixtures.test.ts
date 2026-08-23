import { describe, expect, test } from 'bun:test';
import { MAIL_DEV_SEED_EMAIL, mailDevFixtures } from './dev-fixtures';

describe('mail development fixtures', () => {
  test('are fixed to the approved account and contain realistic threaded replies', () => {
    const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
    const accountKey = 'cmrnlzf650002qc7k4p5zem5w';
    const fixtures = mailDevFixtures(scopeKey, accountKey);
    expect(MAIL_DEV_SEED_EMAIL).toBe('oscar.burman005@gmail.com');
    expect(fixtures.threads.length).toBeGreaterThanOrEqual(2);
    expect(fixtures.threads.some(({ messages }) => messages.some(({ direction }) => direction === 'outbound'))).toBe(true);
    expect(fixtures.threads.every(({ thread, messages }) => thread.scopeKey === scopeKey && messages.every((message) => message.scopeKey === scopeKey && message.accountKey === accountKey))).toBe(true);
    expect(fixtures.tones.map(({ name }) => name)).toEqual(['Casual', 'Formal', 'Concise']);
  });
});
