import { describe, expect, test } from 'bun:test';
import { clientEventSlugSchema, eventSlugSchema } from './events';

describe('event catalog', () => {
  test('accepts dynamic event slugs', () => {
    expect(eventSlugSchema.parse('waitlist.visited')).toBe('waitlist.visited');
    expect(eventSlugSchema.parse('anything.custom')).toBe('anything.custom');
  });

  test('uses the same dynamic schema for client-postable events', () => {
    expect(clientEventSlugSchema.parse('waitlist.visited')).toBe('waitlist.visited');
    expect(clientEventSlugSchema.parse('payment.ticket_purchased')).toBe('payment.ticket_purchased');
  });

  test('rejects empty event slugs', () => {
    expect(() => eventSlugSchema.parse('')).toThrow();
  });

});
