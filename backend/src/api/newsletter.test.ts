import { describe, expect, test } from 'bun:test';
import { normalizeNewsletterEmail } from './newsletter';

describe('newsletter', () => {
  test('normalizes email addresses before lookup', () => {
    expect(normalizeNewsletterEmail('  PERSON@Example.COM ')).toBe('person@example.com');
  });
});
