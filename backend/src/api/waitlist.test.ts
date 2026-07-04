import { describe, expect, test } from 'bun:test';
import { buildWaitlistVerifyLink, normalizeWaitlistEmail } from './waitlist';

describe('waitlist helpers', () => {
  test('normalizes waitlist emails', () => {
    expect(normalizeWaitlistEmail('  PERSON@Example.COM ')).toBe('person@example.com');
  });

  test('builds frontend verification links with token hash query param', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    expect(buildWaitlistVerifyLink('abc123')).toBe('https://app.example.com/public/waitlist/verify?token_hash=abc123');
  });
});
